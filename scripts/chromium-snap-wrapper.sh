#!/bin/sh
# Wrapper so Chromiumoxide's launcher (async_process) can drive snap Chromium.
# Problem: /snap/bin/chromium is a symlink to /usr/bin/snap. async_process
# resolves the symlink for argv[0], so `snap` thinks our Chromium flags are its
# own CLI flags and rejects them ("unknown flag"). `snap run chromium` sets the
# correct argv so flags are forwarded to the browser.
exec /usr/bin/snap run chromium "$@"
