// swift-tools-version: 5.9
import PackageDescription

// Muster's StoreKit 2 plugin. Linked into the app by `npx cap sync ios`, which reads package.json
// ("muster-store": "file:ios/MusterStore") and adds this package to ios/App/CapApp-SPM/Package.swift.
let package = Package(
    name: "MusterStore",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "MusterStore", targets: ["MusterStorePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "MusterStorePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/MusterStorePlugin"),
        .testTarget(
            name: "MusterStorePluginTests",
            dependencies: ["MusterStorePlugin"],
            path: "ios/Tests/MusterStorePluginTests")
    ]
)
