"""Adds voice transcription through the visible Windows WeChat history window."""

import re
import sys
from collections import Counter
from contextlib import redirect_stdout
from importlib import import_module
from time import monotonic, sleep
from unittest.mock import patch

from wechat_mcp.dates import parse_wechat_datetime
from wechat_mcp.server import build_server
from wechat_mcp.wechat_client import WeChatClient, WeChatMCPError


VOICE = re.compile(r'(?P<label>(?:语音|語音|Audio|Voice(?: message)?)\s*\d+\s*["″”]?\s*(?:秒|sec(?:onds?)?))\s*(?P<text>.*)', re.I | re.S)
VOICE_MENU = re.compile(r'^(?:语音转文字|轉文字|轉成文字|語音轉文字|转文字|转成文字|Transcribe|Convert to Text|Voice to Text)$', re.I)
VOICE_STATUS = {'未播放', '已播放', '未收聽', '已收聽', '正在转文字', '转换失败', '转写失败',
                '未能转换', '未能轉換', '轉換失敗', 'unread', 'played'}
TEXT_CLASS = 'mmui::ChatTextItemView'


def voice_info(text, timestamp_pattern):
    timestamp = timestamp_pattern.search(text)
    when = parse_wechat_datetime(timestamp.group()) if timestamp else None
    if not when:
        return None
    body = text[:timestamp.start()] + text[timestamp.end():]
    voice = VOICE.search(body)
    if not voice:
        return None
    transcript = voice.group('text').strip().lstrip('：:').strip()
    if transcript.lower().rstrip('。.…') in VOICE_STATUS:
        transcript = ''
    return (when.isoformat(timespec='minutes'), voice.group('label')), transcript


def is_voice_class(class_name):
    return 'voice' in class_name.lower() or 'audio' in class_name.lower()


def restore_wechat_window():
    from psutil import Process
    from win32con import SW_RESTORE
    from win32gui import FindWindow, IsIconic, ShowWindow
    from win32process import GetWindowThreadProcessId

    for title in ('微信', 'Weixin', 'WeChat'):
        handle = FindWindow('Qt51514QWindowIcon', title)
        if handle and IsIconic(handle):
            pid = GetWindowThreadProcessId(handle)[1]
            if Process(pid).name().lower() == 'weixin.exe':
                ShowWindow(handle, SW_RESTORE)
                return


def transcribe_item(window, row, signature, timestamp_pattern):
    from pywinauto import Desktop, mouse

    runtime = row.element_info.runtime_id
    window.set_focus()
    rect = row.rectangle()
    x = min(rect.left + 110, rect.mid_point().x)
    y = min(rect.top + 60, rect.mid_point().y)
    mouse.right_click(coords=(x, y))
    # Include Qt's owned popup windows. Never select an entry from a different process.
    menu_item = window.child_window(control_type='MenuItem', title_re=VOICE_MENU)
    if not menu_item.exists(timeout=0.25):
        menu_item = None
        for popup in Desktop(backend='uia').windows(process=window.element_info.process_id, visible_only=True):
            found = next((item for item in popup.descendants(control_type='MenuItem')
                          if VOICE_MENU.fullmatch(item.window_text())), None)
            if found is not None:
                menu_item = found
                break
    if menu_item is None:
        window.type_keys('{ESC}')
        return ''
    menu_item.click_input()
    until = monotonic() + 4
    while monotonic() < until:
        sleep(0.25)
        if row.element_info.runtime_id != runtime:
            break
        current = voice_info(row.window_text(), timestamp_pattern)
        if current and current[0] == signature and current[1]:
            return current[1]
    return ''


def transcribe_visible_rows(window, targets, number, timestamp_pattern):
    from pyweixin import Tools
    from pyweixin.Uielements import Lists

    if not targets:
        return {}
    listing = window.child_window(**Lists.ChatHistoryList)
    Tools.activate_chatHistoryList(listing)
    converted = {}
    visited = set()
    deadline = monotonic() + 25
    for _ in range(number + 8):
        if len(converted) == len(targets) or monotonic() >= deadline:
            break
        focused = next((item for item in listing.children() if item.has_keyboard_focus()), None)
        if focused is None:
            break
        runtime = tuple(focused.element_info.runtime_id)
        if runtime in visited:
            break
        visited.add(runtime)
        if is_voice_class(focused.class_name()):
            details = voice_info(focused.window_text(), timestamp_pattern)
            if details and details[0] in targets:
                key, existing = details
                try:
                    converted[key] = existing or transcribe_item(window, focused, key, timestamp_pattern)
                    focused.set_focus()
                except Exception:
                    # Unavailable controls leave the original voice row available for review.
                    break
        listing.type_keys('{DOWN}', set_foreground=False)
    return converted


def voice_traversal(original, start, end, timestamp_pattern):
    def traverse(window, select, number, *args, **kwargs):
        rows = original(window, select, number, *args, **kwargs)
        voice_rows = {}
        for index, (text, class_name, _) in enumerate(rows):
            if is_voice_class(class_name):
                details = voice_info(text, timestamp_pattern)
                if details:
                    voice_rows[index] = details
        counts = Counter(key for key, _ in voice_rows.values())
        targets = {key for key, text in voice_rows.values() if start <= key[0] <= end and counts[key] == 1 and not text}
        try:
            converted = transcribe_visible_rows(window, targets, number, timestamp_pattern) if select else {}
        except Exception:
            converted = {}
        result = []
        for index, (text, class_name, details) in enumerate(rows):
            if index in voice_rows:
                key, _ = voice_rows[index]
                transcript = converted.get(key)
                if transcript:
                    timestamp = timestamp_pattern.search(text)
                    label_end = VOICE.search(text).end('label')
                    tail = ' ' + timestamp.group() if timestamp.start() >= label_end else ''
                    text = text[:label_end] + ' ' + transcript + tail
            # The upstream parser's type switch omits voice items on some pywechat127 versions.
            result.append((text, TEXT_CLASS if is_voice_class(class_name) else class_name, details))
        return result
    return traverse


def main():
    client = WeChatClient()
    server = build_server(client=client)

    @server.tool(name='wechat_get_chat_history_with_voice')
    def get_history(to_user: str, target_date: str, from_minute: str, to_minute: str) -> dict:
        """Read a day and try WeChat's native transcription for voice messages in the requested minutes."""
        with client._lock, redirect_stdout(sys.stderr):
            module = import_module('pyweixin.WeChatAuto')
            elements = import_module('pyweixin.Uielements')
            original = module.traverse_chat_history
            pattern = elements.Regex_Patterns.Chathistory_Timestamp_pattern
            restore_wechat_window()
            try:
                with patch.object(module, 'traverse_chat_history', voice_traversal(original, from_minute, to_minute, pattern)):
                    return client.get_chat_history(friend=to_user, target_date=target_date, save_json=False)
            except WeChatMCPError as error:
                reason = type(error.__cause__ or error).__name__
                return {'status': 'error', 'error_type': reason}

    server.run(transport='stdio')


if __name__ == '__main__':
    main()
