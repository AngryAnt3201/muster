import Foundation
import StoreKit
import UIKit

/// What the game needs to show a product. The price string comes straight from StoreKit (`displayPrice`).
public struct StoreProduct: Equatable {
    public let id: String
    public let title: String
    public let description: String
    public let displayPrice: String
}

/// How a purchase ended, in the same words as the JS store interface (src/store/types.ts BuyStatus).
public enum BuyOutcome: Equatable {
    case purchased
    case pending
    case cancelled
    case failed(String)

    public var status: String {
        switch self {
        case .purchased: return "purchased"
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
            .map { StoreProduct(id: $0.id, title: $0.displayName, description: $0.description, displayPrice: $0.displayPrice) }
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

    /// Finishes any transaction left over from a crash or a purchase made on another device, then listens to
    /// `Transaction.updates` (Ask to Buy approved, refunds, other devices) and calls `changed` with the owned list.
    public func listen(_ changed: @escaping ([String]) -> Void) {
        updates?.cancel()
        updates = Task.detached(priority: .background) { [weak self] in
            for await result in Transaction.unfinished {
                if case .verified(let t) = result { await t.finish() }
            }
            for await result in Transaction.updates {
                if case .verified(let t) = result { await t.finish() }
                guard let self = self, !Task.isCancelled else { return }
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
