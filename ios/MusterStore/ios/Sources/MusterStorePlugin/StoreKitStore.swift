import Foundation
import StoreKit
import UIKit

/// What the game needs to show a product. The price string comes straight from StoreKit (`displayPrice`).
public struct StoreProduct: Equatable {
    public let id: String
    public let title: String
    public let description: String
    public let displayPrice: String
    /// The price as a number, only for comparing gem packs (the "best value" tag). Never shown.
    public let price: Double
}

/// A paid consumable (Starter Pack or gem pack) that hasn't been finished: the game credits it, saves, then calls `finish`.
public struct UnfinishedPurchase: Equatable {
    public let txId: String
    public let productId: String
}

/// How a purchase ended, in the same words as the JS store interface (src/store/types.ts BuyStatus).
public enum BuyOutcome: Equatable {
    case purchased
    /// A consumable paid for and verified but deliberately left unfinished until the game has saved the credit.
    case purchasedUnfinished(UnfinishedPurchase)
    case pending
    case cancelled
    case failed(String)

    public var status: String {
        switch self {
        case .purchased, .purchasedUnfinished: return "purchased"
        case .pending: return "pending"
        case .cancelled: return "cancelled"
        case .failed: return "failed"
        }
    }
    public var message: String? {
        if case .failed(let m) = self { return m }
        return nil
    }
}

/// StoreKit 2, with no Capacitor in it, so it can be tested against a .storekit file with SKTestSession.
public final class StoreKitStore {
    private var updates: Task<Void, Never>?

    public init() {}
    deinit { updates?.cancel() }

    /// Product details for the given ids. Ids the store doesn't know are left out. Throws when the store can't be reached.
    public func products(_ ids: [String]) async throws -> [StoreProduct] {
        let found = try await Product.products(for: ids)
        return found
            .map { StoreProduct(id: $0.id, title: $0.displayName, description: $0.description, displayPrice: $0.displayPrice,
                                price: NSDecimalNumber(decimal: $0.price).doubleValue) }
            .sorted { $0.id < $1.id }
    }

    /// Buys a product. Only a verified transaction counts as purchased, and it is finished here.
    /// `scene` is the window the payment sheet belongs to (iOS 17+ asks for it; without one StoreKit guesses).
    public func buy(_ id: String, in scene: UIScene? = nil) async -> BuyOutcome {
        let product: Product
        do {
            guard let p = try await Product.products(for: [id]).first else {
                return .failed("This item isn't available in the App Store right now.")
            }
            product = p
        } catch {
            return .failed("The App Store can't be reached. Check your connection and try again.")
        }
        do {
            let result: Product.PurchaseResult
            if #available(iOS 17.0, *), let scene = scene {
                result = try await product.purchase(confirmIn: scene)
            } else {
                result = try await product.purchase()
            }
            switch result {
            case .success(.verified(let transaction)):
                if transaction.productType == .consumable {
                    // Gems: not finished here. The game credits them (once per transaction id), saves, then calls
                    // finish(). If the app dies first, Transaction.unfinished offers it again on the next launch.
                    return .purchasedUnfinished(UnfinishedPurchase(txId: String(transaction.id), productId: transaction.productID))
                }
                await transaction.finish()
                return .purchased
            case .success(.unverified(_, _)):
                // A receipt that doesn't check out never unlocks anything. Left unfinished so StoreKit can retry it.
                return .failed("The App Store couldn't confirm this purchase.")
            case .pending:
                return .pending
            case .userCancelled:
                return .cancelled
            @unknown default:
                return .failed("The App Store sent an answer this version doesn't understand.")
            }
        } catch {
            return Self.outcome(for: error)
        }
    }

    /// Restore Purchases: `AppStore.sync()` (may ask the player to sign in), then what they own.
    /// Throws when the sync fails or the player backs out of signing in.
    public func restore() async throws -> [String] {
        try await AppStore.sync()
        return await owned()
    }

    /// Owned product ids from `Transaction.currentEntitlements`: verified and not revoked. Never prompts.
    public func owned() async -> [String] {
        var ids = Set<String>()
        for await result in Transaction.currentEntitlements {
            if case .verified(let t) = result, t.revocationDate == nil { ids.insert(t.productID) }
        }
        return ids.sorted()
    }

    /// Verified consumables that were paid for and never finished (a crash before the credit was saved, or an
    /// Ask to Buy approved while the app was closed). The game credits each one and then calls `finish`.
    public func unfinishedConsumables() async -> [UnfinishedPurchase] {
        var out: [UnfinishedPurchase] = []
        for await result in Transaction.unfinished {
            if case .verified(let t) = result, t.productType == .consumable, t.revocationDate == nil {
                out.append(UnfinishedPurchase(txId: String(t.id), productId: t.productID))
            }
        }
        return out
    }

    /// Finishes one transaction by id, once the game has saved its credit. False when it isn't unfinished any more.
    public func finish(_ txId: String) async -> Bool {
        for await result in Transaction.unfinished {
            let t: Transaction
            switch result {
            case .verified(let v): t = v
            case .unverified(let v, _): t = v
            }
            if String(t.id) == txId { await t.finish(); return true }
        }
        return false
    }

    /// Finishes non-consumables left over from a crash or bought on another device, then listens to
    /// `Transaction.updates`: non-consumables (Ask to Buy approved, refunds, other devices) are finished and `changed`
    /// gets the owned list; a consumable goes to `consumable` unfinished, so the game credits it before it's finished.
    /// Unfinished consumables from before launch are left for `unfinishedConsumables()`.
    public func listen(_ changed: @escaping ([String]) -> Void, consumable: @escaping (UnfinishedPurchase) -> Void = { _ in }) {
        updates?.cancel()
        updates = Task.detached(priority: .background) { [weak self] in
            for await result in Transaction.unfinished {
                if case .verified(let t) = result, t.productType != .consumable { await t.finish() }
            }
            for await result in Transaction.updates {
                guard let self = self, !Task.isCancelled else { return }
                if case .verified(let t) = result {
                    if t.productType == .consumable {
                        if t.revocationDate == nil { consumable(UnfinishedPurchase(txId: String(t.id), productId: t.productID)) }
                        continue
                    }
                    await t.finish()
                }
                changed(await self.owned())
            }
        }
    }

    public func stopListening() {
        updates?.cancel()
        updates = nil
    }

    static func outcome(for error: Error) -> BuyOutcome {
        if let e = error as? StoreKitError {
            switch e {
            case .userCancelled: return .cancelled
            case .networkError: return .failed("The App Store can't be reached. Check your connection and try again.")
            case .notAvailableInStorefront: return .failed("This item isn't available in your country's App Store.")
            case .notEntitled: return .failed("This Apple Account can't make purchases.")
            default: break
            }
        }
        if let e = error as? Product.PurchaseError {
            switch e {
            case .purchaseNotAllowed: return .failed("Purchases are turned off on this device (Screen Time settings).")
            case .productUnavailable: return .failed("This item isn't available in the App Store right now.")
            default: break
            }
        }
        return .failed(error.localizedDescription)
    }
}
