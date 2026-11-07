import XCTest
import StoreKit
import StoreKitTest
import UIKit
@testable import MusterStorePlugin

/// Runs the plugin's StoreKit code against ios/App/Muster.storekit, the same file the App scheme uses.
/// Purchases need a window scene, so these run inside the TestHost app (see ios/MusterStore/TestHost/project.yml).
final class StoreKitStoreTests: XCTestCase {
    /// The one-time Starter Pack: a consumable the game sells once (it hides the offer after the credit is saved).
    static let starter = "co.inflect.muster.starter"
    static let pouch = "co.inflect.muster.gems.pouch"
    var session: SKTestSession!
    var store: StoreKitStore!

    override func setUpWithError() throws {
        let config = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // MusterStorePluginTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // ios
            .deletingLastPathComponent() // MusterStore
            .deletingLastPathComponent() // ios/
            .appendingPathComponent("App/Muster.storekit")
        session = try SKTestSession(contentsOf: config)
        session.resetToDefaultState()
        session.disableDialogs = true
        session.clearTransactions()
        store = StoreKitStore()
    }

    /// The host app's window scene, like the plugin passes the Capacitor view's scene.
    func buy(_ id: String = StoreKitStoreTests.starter) async -> BuyOutcome {
        let scene = await MainActor.run { UIApplication.shared.connectedScenes.first }
        return await store.buy(id, in: scene)
    }

    override func tearDown() {
        store.stopListening()
        session.clearTransactions()
    }

    func testProductComesFromTheStoreKitFile() async throws {
        let products = try await store.products([Self.starter, "co.inflect.muster.fullarmy", "co.inflect.muster.nope"])
        XCTAssertEqual(products.map(\.id), [Self.starter], "the old Full Army is gone from the StoreKit file")
        XCTAssertEqual(products.first?.title, "Starter Pack")
        XCTAssertTrue(products.first?.displayPrice.contains("4.99") ?? false, products.first?.displayPrice ?? "no price")
    }

    /// The Starter Pack is paid but left unfinished until the game has saved the credit, then finished by id.
    /// It is a consumable, so it is never owned and Restore has nothing to bring back.
    func testStarterPackStaysUnfinishedUntilTheGameFinishesIt() async throws {
        let outcome = await buy()
        guard case .purchasedUnfinished(let p) = outcome else { return XCTFail("expected an unfinished purchase, got \(outcome)") }
        XCTAssertEqual(p.productId, Self.starter)
        let open = await store.unfinishedConsumables()
        XCTAssertEqual(open, [p])
        let owned = await store.owned()
        XCTAssertEqual(owned, [])
        let restored = try await store.restore()
        XCTAssertEqual(restored, [], "nothing Muster sells is restorable")
        let finished = await store.finish(p.txId)
        XCTAssertTrue(finished)
        let after = await store.unfinishedConsumables()
        XCTAssertEqual(after, [])
    }

    func testUnknownProductFails() async {
        let outcome = await buy("co.inflect.muster.nope")
        XCTAssertEqual(outcome.status, "failed")
    }

    func testAskToBuyStarterPackIsPendingThenArrivesUnfinishedThroughUpdates() async throws {
        session.askToBuyEnabled = true
        let arrived = expectation(description: "Starter Pack from Transaction.updates")
        store.listen({ _ in }, consumable: { p in if p.productId == Self.starter { arrived.fulfill() } })
        let outcome = await buy()
        XCTAssertEqual(outcome, .pending)
        let notYet = await store.unfinishedConsumables()
        XCTAssertEqual(notYet, [])
        let pending = try XCTUnwrap(session.allTransactions().first)
        try session.approveAskToBuyTransaction(identifier: pending.identifier)
        await fulfillment(of: [arrived], timeout: 10)
        let open = await store.unfinishedConsumables()
        XCTAssertEqual(open.map(\.productId), [Self.starter])
    }

    func testFailedTransactionIsFailed() async {
        session.failTransactionsEnabled = true
        let outcome = await buy()
        XCTAssertEqual(outcome.status, "failed")
        XCTAssertNotNil(outcome.message)
        let open = await store.unfinishedConsumables()
        XCTAssertEqual(open, [], "a failed purchase leaves nothing to credit")
    }

    func testGemPacksComeFromTheStoreKitFileWithPrices() async throws {
        let ids = ["pouch", "sack", "coffer", "trove", "hoard"].map { "co.inflect.muster.gems.\($0)" }
        let products = try await store.products(ids)
        XCTAssertEqual(products.count, 5)
        XCTAssertTrue(products.allSatisfy { $0.price > 0 && !$0.displayPrice.isEmpty })
    }

    /// A gem pack is paid but left unfinished until the game has saved the credit, then finished by id.
    func testGemPackStaysUnfinishedUntilTheGameFinishesIt() async throws {
        let outcome = await buy(Self.pouch)
        guard case .purchasedUnfinished(let p) = outcome else { return XCTFail("expected an unfinished purchase, got \(outcome)") }
        XCTAssertEqual(outcome.status, "purchased")
        XCTAssertEqual(p.productId, Self.pouch)
        let open = await store.unfinishedConsumables()
        XCTAssertEqual(open, [p])
        let owned = await store.owned()
        XCTAssertEqual(owned, [], "consumables are never owned or restored")
        let finished = await store.finish(p.txId)
        XCTAssertTrue(finished)
        let after = await store.unfinishedConsumables()
        XCTAssertEqual(after, [])
        let again = await store.finish(p.txId)
        XCTAssertFalse(again)
    }

    func testAskToBuyGemPackArrivesUnfinishedThroughUpdates() async throws {
        session.askToBuyEnabled = true
        let arrived = expectation(description: "consumable from Transaction.updates")
        store.listen({ _ in }, consumable: { p in if p.productId == Self.pouch { arrived.fulfill() } })
        let outcome = await buy(Self.pouch)
        XCTAssertEqual(outcome, .pending)
        let pending = try XCTUnwrap(session.allTransactions().first)
        try session.approveAskToBuyTransaction(identifier: pending.identifier)
        await fulfillment(of: [arrived], timeout: 10)
        let open = await store.unfinishedConsumables()
        XCTAssertEqual(open.map(\.productId), [Self.pouch])
    }

    func testErrorMapping() {
        XCTAssertEqual(StoreKitStore.outcome(for: StoreKitError.userCancelled), .cancelled)
        XCTAssertEqual(StoreKitStore.outcome(for: StoreKitError.networkError(URLError(.notConnectedToInternet))).status, "failed")
        XCTAssertEqual(StoreKitStore.outcome(for: Product.PurchaseError.purchaseNotAllowed).status, "failed")
    }
}
