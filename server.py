#!/usr/bin/env python3
"""本地静态服务器：带 no-store 缓存头，避免浏览器缓存旧版 js/素材。用法：python3 server.py [端口]"""
import http.server
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8642


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 静音日志


if __name__ == '__main__':
    http.server.test(HandlerClass=Handler, port=PORT, bind='127.0.0.1')
