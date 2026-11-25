#!/usr/bin/env python3
# The desktop's own file picker (xdg-desktop-portal FileChooser) for the + menu's Review a page.
# Prints each chosen path on its own line, and nothing when cancelled. The argument is the title.
# The menu's popup can close while the picker is open, so a shell runs this in place of pickFiles.
import sys
from urllib.parse import unquote, urlparse

from gi.repository import Gio, GLib

title = sys.argv[1] if len(sys.argv) > 1 else "Open"
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
token = f"herdr_chat_{GLib.random_int()}"
sender = bus.get_unique_name()[1:].replace(".", "_")
path = f"/org/freedesktop/portal/desktop/request/{sender}/{token}"
loop = GLib.MainLoop()
chosen = []


def response(_bus, _sender, _path, _iface, _signal, params):
    code, results = params.unpack()
    if code == 0:
        for uri in results.get("uris", []):
            u = urlparse(uri)
            if u.scheme == "file":
                chosen.append(unquote(u.path))
    loop.quit()


# Listen before asking, so the answer can't come first.
bus.signal_subscribe("org.freedesktop.portal.Desktop", "org.freedesktop.portal.Request", "Response",
                     path, None, Gio.DBusSignalFlags.NONE, response)
bus.call_sync("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop",
              "org.freedesktop.portal.FileChooser", "OpenFile",
              GLib.Variant("(ssa{sv})", ("", title, {
                  "handle_token": GLib.Variant("s", token),
                  "multiple": GLib.Variant("b", True),
                  "accept_label": GLib.Variant("s", "Attach"),
              })), GLib.VariantType("(o)"), Gio.DBusCallFlags.NONE, -1, None)
loop.run()
print("\n".join(chosen))
