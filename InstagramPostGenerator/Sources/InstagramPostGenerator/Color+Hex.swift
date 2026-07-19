import SwiftUI

extension Color {
    /// Ստեղծում է գույն 0xRRGGBB ձևաչափի hex-ից։
    /// Creates a Color from a 0xRRGGBB hex value.
    init(hex: UInt32, opacity: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8) & 0xFF) / 255.0
        let b = Double(hex & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: opacity)
    }
}
