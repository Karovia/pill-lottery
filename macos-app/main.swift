// 吃药大转盘 · macOS 原生壳
// 用 WKWebView 加载打进包内的静态资源（自定义 app:// 协议），双击即开，无需服务器。
import Cocoa
import WebKit

// 把 app:// 请求映射到 App 包内 Resources 目录
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    private let base: URL
    private let mime: [String: String] = [
        "html": "text/html", "css": "text/css", "js": "application/javascript",
        "png": "image/png", "mp4": "video/mp4", "woff2": "font/woff2",
        "md": "text/plain", "json": "application/json"
    ]
    init(base: URL) { self.base = base }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(NSError(domain: "pill", code: 404)); return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        path = path.removingPercentEncoding ?? path
        let fileURL = base.appendingPathComponent(path).standardizedFileURL
        guard fileURL.path.hasPrefix(base.standardizedFileURL.path),
              FileManager.default.fileExists(atPath: fileURL.path),
              let data = try? Data(contentsOf: fileURL) else {
            task.didFailWithError(NSError(domain: "pill", code: 404)); return
        }
        let ext = fileURL.pathExtension.lowercased()
        let response = URLResponse(url: url,
                                   mimeType: mime[ext] ?? "application/octet-stream",
                                   expectedContentLength: data.count,
                                   textEncodingName: ext == "mp4" ? nil : "utf-8")
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow?
    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let res = Bundle.main.resourceURL else { NSApp.terminate(nil); return }
        let cfg = WKWebViewConfiguration()
        // 允许免手势自动播放（macOS 走 preferences 的 KVC；键不存在时安全跳过）
        if cfg.preferences.responds(to: Selector(("setMediaTypesRequiringUserActionForAutoplay:"))) {
            cfg.preferences.setValue(false, forKey: "mediaTypesRequiringUserActionForAutoplay")
        }
        cfg.setURLSchemeHandler(SchemeHandler(base: res), forURLScheme: "app")

        let wv = WKWebView(frame: NSRect(x: 0, y: 0, width: 1080, height: 900), configuration: cfg)
        wv.autoresizingMask = [.width, .height]

        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1080, height: 900),
                           styleMask: [.titled, .closable, .miniaturizable, .resizable],
                           backing: .buffered, defer: false)
        win.title = "吃药大转盘"
        win.minSize = NSSize(width: 700, height: 640)
        win.contentView = wv
        win.center()
        win.makeKeyAndOrderFront(nil)
        window = win

        wv.load(URLRequest(url: URL(string: "app://local/index.html")!))
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
