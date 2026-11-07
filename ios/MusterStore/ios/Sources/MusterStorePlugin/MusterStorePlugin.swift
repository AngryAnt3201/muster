import Foundation
import Capacitor

/// The MusterStore Capacitor plugin: the bridge between StoreKit 2 and src/store/native.ts.
/// The JS contract (keep in step with the header of src/store/native.ts):
///   getProducts({ ids })  -> { products: [{ id, title, description, displayPrice, price }] }
///   purchase({ id })      -> { status: "purchased" | "pending" | "cancelled" | "failed", message?, txId?, productId? }
///                            a consumable comes back with txId and stays unfinished until finish({ txId })
///   restore()             -> { owned: [id] }      rejects when AppStore.sync() fails (non-consumables only)
///   owned()               -> { owned: [id] }
///   unfinished()          -> { purchases: [{ txId, productId }] }   paid gem packs not finished yet
///   finish({ txId })      -> { finished: bool }   after the game has saved the credit
///   event "ownedChanged"  -> { owned: [id] }      from Transaction.updates
///   event "purchase"      -> { txId, productId }  a consumable from Transaction.updates (retained until a listener)
@objc(MusterStorePlugin)
public class MusterStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MusterStorePlugin"
    public let jsName = "MusterStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "owned", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unfinished", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise)
    ]

    private let store = StoreKitStore()

    override public func load() {
        store.listen({ [weak self] owned in
            self?.notifyListeners("ownedChanged", data: ["owned": owned])
        }, consumable: { [weak self] p in
            // Retained until the game's listener is attached, so an approval at launch isn't lost.
            self?.notifyListeners("purchase", data: ["txId": p.txId, "productId": p.productId], retainUntilConsumed: true)
        })
    }

    deinit { store.stopListening() }

    @objc func getProducts(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") ?? []).compactMap { $0 as? String }
        Task {
            do {
                let products = try await store.products(ids)
                call.resolve(["products": products.map {
                    ["id": $0.id, "title": $0.title, "description": $0.description, "displayPrice": $0.displayPrice, "price": $0.price]
                }])
            } catch {
                call.reject("The App Store can't be reached.", nil, error)
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty else {
            call.resolve(["status": "failed", "message": "No product id."])
            return
        }
        Task { @MainActor in
            let scene = self.bridge?.viewController?.view.window?.windowScene
            let outcome = await self.store.buy(id, in: scene)
            var reply: [String: Any] = ["status": outcome.status]
            if let m = outcome.message { reply["message"] = m }
            if case .purchasedUnfinished(let p) = outcome {
                reply["txId"] = p.txId
                reply["productId"] = p.productId
            }
            call.resolve(reply)
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do {
                call.resolve(["owned": try await store.restore()])
            } catch {
                call.reject("Couldn't restore purchases. Check your connection and Apple Account, then try again.", nil, error)
            }
        }
    }

    @objc func owned(_ call: CAPPluginCall) {
        Task { call.resolve(["owned": await store.owned()]) }
    }

    @objc func unfinished(_ call: CAPPluginCall) {
        Task {
            let list = await store.unfinishedConsumables()
            call.resolve(["purchases": list.map { ["txId": $0.txId, "productId": $0.productId] }])
        }
    }

    @objc func finish(_ call: CAPPluginCall) {
        guard let txId = call.getString("txId"), !txId.isEmpty else {
            call.resolve(["finished": false])
            return
        }
        Task { call.resolve(["finished": await store.finish(txId)]) }
    }
}
