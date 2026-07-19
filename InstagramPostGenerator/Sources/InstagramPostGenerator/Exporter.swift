import SwiftUI
import AppKit

/// Արտահանման օգնականը՝ SwiftUI տեսքը վերածում է PNG ֆայլի։
/// Export helper: turns a SwiftUI view into a PNG file.
enum Exporter {

    /// Նկարում է հրապարակումը ամբողջական չափով և պահում որպես PNG։
    /// Renders the post at full resolution and saves it as a PNG.
    /// - Returns: `true` եթե պահպանվեց, `false` եթե օգտատերը չեղարկեց կամ սխալ եղավ։
    @MainActor
    static func exportPNG(model: PostModel) -> Bool {
        let renderer = ImageRenderer(content: PostCanvasView(model: model))
        // scale = 1, քանի որ տեսքն արդեն իրական պիքսելային չափով է։
        renderer.scale = 1.0

        guard let nsImage = renderer.nsImage,
              let tiff = nsImage.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff),
              let pngData = bitmap.representation(using: .png, properties: [:]) else {
            return false
        }

        let panel = NSSavePanel()
        panel.allowedContentTypes = [.png]
        panel.nameFieldStringValue = "instagram-post.png"
        panel.canCreateDirectories = true

        guard panel.runModal() == .OK, let url = panel.url else {
            return false
        }

        do {
            try pngData.write(to: url)
            return true
        } catch {
            return false
        }
    }

    /// Պատճենում է տեքստը համակարգի փոխանակման հիշողություն (clipboard)։
    /// Copies text to the system clipboard.
    static func copyToClipboard(_ text: String) {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(text, forType: .string)
    }
}
