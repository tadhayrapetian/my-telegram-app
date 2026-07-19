import SwiftUI

/// Հրապարակման վիզուալ ներկայացումը՝ ճշգրիտ պիքսելային չափերով։
/// The visual post rendered at its exact pixel dimensions.
///
/// Այս տեսքը միշտ նկարվում է իրական չափով (օր.՝ 1080×1080)։
/// Նախադիտման համար այն մասշտաբավորվում է `.scaleEffect`-ով,
/// իսկ արտահանման համար `ImageRenderer`-ը վերցնում է ամբողջական չափը։
struct PostCanvasView: View {
    @ObservedObject var model: PostModel

    var body: some View {
        let size = model.format.pixelSize
        let pad = size.width * 0.09

        ZStack(alignment: model.alignment.frameAlignment) {
            // Ֆոն / Background gradient
            LinearGradient(
                colors: model.theme.colors,
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            // Դեկորատիվ շրջանակներ / Decorative circles
            GeometryReader { geo in
                Circle()
                    .fill(Color.white.opacity(0.08))
                    .frame(width: geo.size.width * 0.6)
                    .offset(x: geo.size.width * 0.45, y: -geo.size.height * 0.2)
                Circle()
                    .fill(Color.white.opacity(0.06))
                    .frame(width: geo.size.width * 0.4)
                    .offset(x: -geo.size.width * 0.2, y: geo.size.height * 0.75)
            }

            // Տեքստ / Text block
            VStack(alignment: horizontalAlignment, spacing: size.width * 0.03) {
                if !model.title.isEmpty {
                    Text(model.title)
                        .font(.system(size: model.titleFontSize, weight: .bold, design: .rounded))
                        .foregroundColor(model.textColor)
                        .multilineTextAlignment(model.alignment.swiftUIAlignment)
                        .shadow(color: .black.opacity(0.25), radius: size.width * 0.01, y: size.width * 0.005)
                }
                if !model.subtitle.isEmpty {
                    Text(model.subtitle)
                        .font(.system(size: model.subtitleFontSize, weight: .medium, design: .rounded))
                        .foregroundColor(model.textColor.opacity(0.9))
                        .multilineTextAlignment(model.alignment.swiftUIAlignment)
                }
            }
            .padding(pad)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: model.alignment.frameAlignment)
        }
        .frame(width: size.width, height: size.height)
    }

    private var horizontalAlignment: HorizontalAlignment {
        switch model.alignment {
        case .leading:  return .leading
        case .center:   return .center
        case .trailing: return .trailing
        }
    }
}
