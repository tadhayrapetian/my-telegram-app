import SwiftUI

struct ContentView: View {
    @StateObject private var model = PostModel()
    @State private var statusMessage: String?

    private var lang: AppLanguage { model.language }

    var body: some View {
        HStack(spacing: 0) {
            controlsPanel
                .frame(width: 380)
                .background(Color(nsColor: .windowBackgroundColor))

            Divider()

            previewPanel
                .frame(minWidth: 460)
                .background(Color(nsColor: .underPageBackgroundColor))
        }
        .frame(minWidth: 900, minHeight: 640)
    }

    // MARK: - Ձախ վահանակ / Left controls panel

    private var controlsPanel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header

                section(Strings.content(lang)) {
                    labeledField(Strings.title(lang)) {
                        TextField(Strings.titlePlaceholder(lang), text: $model.title)
                            .textFieldStyle(.roundedBorder)
                    }
                    labeledField(Strings.subtitle(lang)) {
                        TextField(Strings.subtitlePlaceholder(lang), text: $model.subtitle)
                            .textFieldStyle(.roundedBorder)
                    }
                    labeledField(Strings.caption(lang)) {
                        TextEditor(text: $model.caption)
                            .frame(height: 70)
                            .font(.body)
                            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.3)))
                    }
                }

                section(Strings.style(lang)) {
                    labeledField(Strings.theme(lang)) { themePicker }
                    HStack {
                        Text(Strings.textColor(lang))
                        Spacer()
                        ColorPicker("", selection: $model.textColor, supportsOpacity: false)
                            .labelsHidden()
                    }
                    labeledField(Strings.alignment(lang)) {
                        Picker("", selection: $model.alignment) {
                            ForEach(TextAlignmentOption.allCases) { opt in
                                Text(opt.label(lang)).tag(opt)
                            }
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                    }
                    labeledField("\(Strings.fontSize(lang)): \(Int(model.titleFontSize))") {
                        Slider(value: $model.titleFontSize, in: 40...160, step: 2)
                    }
                }

                section(Strings.format(lang)) {
                    Picker("", selection: $model.format) {
                        ForEach(PostFormat.allCases) { f in
                            Text(f.label(lang)).tag(f)
                        }
                    }
                    .pickerStyle(.radioGroup)
                    .labelsHidden()
                }

                section(Strings.hashtags(lang)) {
                    Button(Strings.generateHashtags(lang)) {
                        let source = model.title + " " + model.subtitle + " " + model.caption
                        model.hashtags = HashtagGenerator.suggest(from: source)
                    }
                    TextEditor(text: $model.hashtags)
                        .frame(height: 60)
                        .font(.callout)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.3)))
                    Button(Strings.copyHashtags(lang)) {
                        Exporter.copyToClipboard(model.hashtags)
                        flash(Strings.copied(lang))
                    }
                    .disabled(model.hashtags.isEmpty)
                }

                section(Strings.export(lang)) {
                    Button {
                        if Exporter.exportPNG(model: model) {
                            flash(Strings.saved(lang))
                        }
                    } label: {
                        Label(Strings.exportPNG(lang), systemImage: "square.and.arrow.down")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)

                    Button(Strings.copyCaption(lang)) {
                        let full = model.caption + (model.hashtags.isEmpty ? "" : "\n\n" + model.hashtags)
                        Exporter.copyToClipboard(full)
                        flash(Strings.copied(lang))
                    }

                    Text(Strings.exportHint(lang))
                        .font(.caption)
                        .foregroundColor(.secondary)

                    if let statusMessage {
                        Text(statusMessage)
                            .font(.callout.bold())
                            .foregroundColor(.green)
                    }
                }
            }
            .padding(22)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(Strings.appTitle(lang))
                .font(.title2.bold())
            Picker(Strings.language(lang), selection: $model.language) {
                ForEach(AppLanguage.allCases) { l in
                    Text("\(l.flag) \(l.nativeName)").tag(l)
                }
            }
            .pickerStyle(.segmented)
        }
    }

    private var themePicker: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
            ForEach(Theme.all) { theme in
                LinearGradient(colors: theme.colors, startPoint: .topLeading, endPoint: .bottomTrailing)
                    .frame(height: 42)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.accentColor, lineWidth: model.theme == theme ? 3 : 0)
                    )
                    .onTapGesture { model.theme = theme }
                    .help(theme.name(lang))
            }
        }
    }

    // MARK: - Աջ վահանակ / Right preview panel

    private var previewPanel: some View {
        VStack(spacing: 14) {
            Text(Strings.preview(lang))
                .font(.headline)
                .foregroundColor(.secondary)

            GeometryReader { geo in
                let size = model.format.pixelSize
                let scale = min(geo.size.width / size.width,
                                geo.size.height / size.height) * 0.92
                PostCanvasView(model: model)
                    .frame(width: size.width, height: size.height)
                    .scaleEffect(scale)
                    .frame(width: size.width * scale, height: size.height * scale)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .shadow(radius: 12)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .padding(24)
    }

    // MARK: - Օգնականներ / Helpers

    @ViewBuilder
    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title.uppercased())
                .font(.caption.bold())
                .foregroundColor(.secondary)
            content()
        }
    }

    @ViewBuilder
    private func labeledField<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.callout)
            content()
        }
    }

    /// Ցուցադրում է ժամանակավոր հաղորդագրություն և թաքցնում 2 վայրկյան հետո։
    private func flash(_ message: String) {
        statusMessage = message
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            if statusMessage == message { statusMessage = nil }
        }
    }
}
