import XCTest
import StoreKit
import StoreKitTest
import UIKit
@testable import MusterStorePlugin

/// Runs the plugin's StoreKit code against ios/App/Muster.storekit, the same file the App scheme uses.
/// Purchases need a window scene, so these run inside the TestHost app (see ios/MusterStore/TestHost/project.yml).
final class StoreKitStoreTests: XCTestCase {
    static let fullArmy = "co.inflect.muster.fullarmy"
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
    func buy(_ id: String = StoreKitStoreTests.fullArmy) async -> BuyOutcome {
        let scene = await MainActor.run { UIApplication.shared.connectedScenes.first }
        return await store.buy(id, in: scene)
    }

    override func tearDown() {
        store.stopListening()
        session.clearTransactions()
    }

    func testProductComesFromTheStoreKitFile() async throws {
        let products = try await store.products([Self.fullArmy, "co.inflect.muster.nope"])
        XCTAssertEqual(products.map(\.id), [Self.fullArmy])
        XCTAssertEqual(products.first?.title, "Full Army")
        XCTAssertTrue(products.first?.displayPrice.contains("4.99") ?? false, products.first?.displayPrice ?? "no price")
    }

    func testBuyThenOwnedThenRestore() async throws {
        let before = await store.owned()
        XCTAssertEqual(before, [])
        let outcome = await buy()
        XCTAssertEqual(outcome, .purchased)
        let after = await store.owned()
        XCTAssertEqual(after, [Self.fullArmy])
        let restored = try await store.restore()
        XCTAssertEqual(restored, [Self.fullArmy])
    }

    func testUnknownProductFails() async {
        let outcome = await buy("co.inflect.muster.nope")
        XCTAssertEqual(outcome.status, "failed")
    }

    func testAskToBuyIsPendingThenApprovalArrivesAsAnUpdate() async throws {
        session.askToBuyEnabled = true
        let changed = expectation(description: "ownedChanged after approval")
        store.listen { owned in if owned.contains(Self.fullArmy) { changed.fulfill() } }
        let outcome = await buy()
        XCTAssertEqual(outcome, .pending)
        let notYet = await store.owned()
        XCTAssertEqual(notYet, [])
        let pending = try XCTUnwrap(session.allTransactions().first)
        try session.approveAskToBuyTransaction(identifier: pending.identifier)
        await fulfillment(of: [changed], timeout: 10)
    }

    func testFailedTransactionIsFailed() async {
        session.failTransactionsEnabled = true
        let outcome = await buy()
        XCTAssertEqual(outcome.status, "failed")
        XCTAssertNotNil(outcome.message)
        let owned = await store.owned()
        XCTAssertEqual(owned, [])
    }

    func testRefundTakesItBack() async throws {
        let outcome = await buy()
        XCTAssertEqual(outcome, .purchased)
        let gone = expectation(description: "ownedChanged after refund")
        store.listen { owned in if owned.isEmpty { gone.fulfill() } }
        let bought = try XCTUnwrap(session.allTransactions().first)
        try session.refundTransaction(identifier: bought.identifier)
        await fulfillment(of: [gone], timeout: 10)
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
