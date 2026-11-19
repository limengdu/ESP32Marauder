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

- **Dual-band survey** enables channel hopping for the survey, supports timed auto-stop or manual stop, and restores the prior setting when it stops. Use the 2.4 GHz and 5 GHz links to open filtered Wi-Fi results.
- **Motion sensing (CSI)** uses an access point you own. Scan for access points, select one, start sensing, and keep the board and room still for 30 seconds. The card shows the latest reading. Use the separate status and calibration controls while the task is running.
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
