import Foundation
import Capacitor

/// The MusterStore Capacitor plugin: the bridge between StoreKit 2 and src/store/native.ts.
/// The JS contract (keep in step with the header of src/store/native.ts):
///   getProducts({ ids })  -> { products: [{ id, title, description, displayPrice }] }
///   purchase({ id })      -> { status: "purchased" | "pending" | "cancelled" | "failed", message? }
///   restore()             -> { owned: [id] }      rejects when AppStore.sync() fails
///   owned()               -> { owned: [id] }
///   event "ownedChanged"  -> { owned: [id] }      from Transaction.updates
@objc(MusterStorePlugin)
public class MusterStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MusterStorePlugin"
    public let jsName = "MusterStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "owned", returnType: CAPPluginReturnPromise)
    ]

    private let store = StoreKitStore()

    override public func load() {
        store.listen { [weak self] owned in
            self?.notifyListeners("ownedChanged", data: ["owned": owned])
        }
    }

    deinit { store.stopListening() }

    @objc func getProducts(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") ?? []).compactMap { $0 as? String }
        Task {
            do {
                let products = try await store.products(ids)
                call.resolve(["products": products.map {
                    ["id": $0.id, "title": $0.title, "description": $0.description, "displayPrice": $0.displayPrice]
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
}
