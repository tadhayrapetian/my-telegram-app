// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "InstagramPostGenerator",
    platforms: [
        .macOS(.v13) // ImageRenderer requires macOS 13+
    ],
    targets: [
        .executableTarget(
            name: "InstagramPostGenerator",
            path: "Sources/InstagramPostGenerator"
        )
    ]
)
