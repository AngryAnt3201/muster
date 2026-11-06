import XCTest
import StoreKit
import StoreKitTest
import UIKit
@testable import MusterStorePlugin

/// Runs the plugin's StoreKit code against ios/App/Muster.storekit, the same file the App scheme uses.
/// Purchases need a window scene, so these run inside the TestHost app (see ios/MusterStore/TestHost/project.yml).
final class StoreKitStoreTests: XCTestCase {
    static let fullArmy = "co.inflect.muster.fullarmy"
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

    func testErrorMapping() {
        XCTAssertEqual(StoreKitStore.outcome(for: StoreKitError.userCancelled), .cancelled)
        XCTAssertEqual(StoreKitStore.outcome(for: StoreKitError.networkError(URLError(.notConnectedToInternet))).status, "failed")
        XCTAssertEqual(StoreKitStore.outcome(for: Product.PurchaseError.purchaseNotAllowed).status, "failed")
    }
}
