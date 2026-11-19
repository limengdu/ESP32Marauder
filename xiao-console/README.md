# XIAO Control

A local browser console for XIAO ESP32-C5 boards running ESP32 Marauder. Use the top bar to switch between English and Simplified Chinese. The browser remembers the language, monitor proportions and font size when site storage is available.

## Run

From the repository root:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory xiao-console
```

Open <http://127.0.0.1:8765/> in Chrome or Edge. Click **Connect device** and select the board's serial port. A previously authorized port is reused when exactly one matching port is available. The console identifies the firmware, checks GPS availability and retrieves the board's existing Wi-Fi and Bluetooth results after connecting.

To stop a foreground preview server, press `Ctrl+C` in its terminal.

## Basic commands

Set the options in a card, review its description and displayed command, and click **Run operation**. Each card covers one device operation. Scan and observation cards include a **Scan duration** selector (`15 s`–`300 s`, or **Until stopped**). Timed scans automatically send `stopscan` and load results when the countdown ends, and **Stop task** in the monitor stops any task early.

- **Wi-Fi observation** covers access points, associated stations, probe requests, raw frame statistics and packet counts.
- **Results and selection** reads the firmware lists and details, toggles access-point selection for packet counts, and clears the chosen device list after confirmation.
- **Channel controls** read or change the configured channel and toggle channel hopping.
- **Bluetooth** starts discovery and reads device results. The result table exports to CSV.
- **Device controls** reads device information and settings. **Check serial connection** confirms that the firmware answers. **Stop task** confirms the board has stopped if the task status is uncertain.

## Advanced tools

The advanced page keeps the connection, result lists and serial monitor from the basic page.

- **Dual-band survey** enables channel hopping for the survey, supports timed auto-stop or manual stop, and restores the prior setting when it stops. The page then groups networks by name and shows the 2.4 GHz and 5 GHz signal, channel, and the stronger band together. **Save this spot** keeps the current signals so the next survey can show the change in parentheses. The 2.4 GHz and 5 GHz links open the full result tables.
- **Motion sensing (CSI)** listens to an access point you own. In **Start motion sensing**, select a measured access point, enter its name, or enter the router's radio address (BSSID) and channel. These passive options work without joining Wi-Fi or entering a password, including on hidden networks. For a name shared by several access points, select the intended BSSID from the list. Firmware supporting `csimotion connected` also lets you use the board's existing connection or explicitly join a network to identify its radio. Only the join option shows a password field. Leave it blank for open Wi-Fi. Keep another device on that access point playing or downloading, and keep the board still for about 30 seconds. On XIAO ESP32-C5, the console reports when the router is in range but all observed frames use 802.11b. These frames carry no CSI. The console distinguishes channel-wide CSI from CSI attributed to the selected transmitter. For an active download, verify the client's BSSID and channel in the router's connected devices list. A sample rate above 0 means samples are arriving; the chart then draws usable scores from 0 to 100 and leaves a gap when a reading has no usable score. The state reads Calibrating, Still, Possible motion, Motion detected, or Not enough data. The calibration percentage is the elapsed timer, while a score appears only after the firmware has a usable baseline. Point at the chart to read one sample, and use **Stop sensing** to end the session.
  - For a **Gateway self-test (60 seconds)**, choose that target in **Start motion sensing**. Enter the exact SSID of a profile saved on the board, the router's BSSID and its channel, then click **Start motion sensing**. The console verifies the radio address and channel and sends `csimotion selftest <AP index> "<SSID>"`, including when it reuses an AP entry. The board reads its saved credentials locally. Allow about 12 seconds to connect. Once sensing starts, the board sends ordinary pings only to the DHCP gateway, at most five per second for about 60 seconds. Keep still for the first 30 seconds of calibration, then walk between the board and router. On `CSI self-test complete` the board stops and the console returns to idle with the last curve visible. On `CSI self-test failed:` the console shows the firmware reason and enables another attempt.
- **Wi-Fi join & LAN** shows the live **Board Wi-Fi status** (state, SSID, IP address, gateway, netmask, **Check status**, and **Disconnect Wi-Fi**), connects the board to your own Wi-Fi network, and runs local host discovery. Confirm you are authorized to inspect the connected network, pick a scanned network or enter a Wi-Fi name (SSID) and password directly in **Connect & save Wi-Fi** (using `join -a <index> -p <password>`, registering an unscanned SSID with `add -a` first when needed) to store credentials on the board (up to 5 profiles) or reuse **Join saved Wi-Fi** (`join -s`), then run ARP or Ping discovery, stop the scan with **Stop LAN scan**, and view the discovered host list in the summary panel and serial monitor.
- **Wireless detectors** support timed durations or continuous listening until stopped, reporting observed disconnect and negotiation frames, access-point and Bluetooth broadcast signatures, and received Remote ID broadcasts in the monitor. Treat a matching signature as an observation to verify on your equipment.
- **Wi-Fi signal finder** shows the latest signal reading for a selected access point. Use it with your own equipment and compare readings as you move the board.
- **USB packet capture** saves a local PCAP file. Scan for networks, choose your own network, set a duration, and start a capture. Use **Stop task** to finish early, then **Download PCAP**. Packet count mode focuses on the selected network. The other modes record frames on that network's channel.
- **GPS** shows fix status and supports live readings with an external GPS module.

Capture data is transferred over USB and held in the browser, up to 32 MiB per capture. Download it before starting a new capture or closing the page. The console temporarily adjusts PCAP saving and channel hopping, then restores the original settings after stopping. If the connection is interrupted, check those settings after reconnecting.

## Wi-Fi results

Choose a **Scan duration** (`15 s`–`300 s`, or **Until stopped**) beside **Start scan** to discover nearby access points and stations. Timed scans automatically stop when the countdown finishes and read the board's list and details; **Stop and show results** ends a scan early and reads results immediately. **Read device results** refreshes the table at any time while the device is idle. Search by name or address, filter by frequency band, sort by signal strength, or click **View** for details. **Export CSV** downloads the current network list.

Association counts show records observed during scanning. Per-network station-address lists show unicast devices.

## Serial monitor

The serial monitor stays beside the workspace on wide screens and below it on narrow screens. Drag the divider to resize it, or use the arrow keys when the divider has focus. Use **Command input** or `Ctrl+Backquote` (`Command+Backquote` on Mac) to focus the monitor.

The monitor accepts commands supported by the command cards. Use the cards for clear-list confirmation and packaged operations. The up and down arrow keys browse the last 100 manually sent commands. The toolbar provides automatic scrolling, output filters, font-size controls, log export, clear and **Stop task**. The latest 5,000 lines are retained for the page session.

The console waits for a response before sending the next command. Operation timeouts show in the workspace. The interface follows the selected language, and raw command output stays in its original form.

## Files

- `index.html` and `style.css` define the workspace, cards and result tables.
- `functions.js` defines operation cards, their parameters and availability.
- `app.js` handles serial connection, task state, result parsing and downloads.
- `capture.js` and `pcap.js` handle capture controls and USB capture data.
- `monitor.js` handles monitor proportions, output controls and preferences.
- `en.json` and `zh-CN.json` provide matching interface messages.
