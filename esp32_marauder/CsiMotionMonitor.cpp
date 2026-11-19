#include "CsiMotionMonitor.h"

#if defined(HAS_CSI_MOTION)

#include <string.h>
#include <new>
#include "MemoryGuard.h"
#include "WiFiScan.h"
#if defined(HAS_SCREEN)
  #include "Display.h"
#endif
#include "settings.h"
#if defined(CONFIG_IDF_TARGET_ESP32C5)
  #include "esp_netif.h"
  #include "ping/ping_sock.h"
#endif

extern WiFiScan wifi_scan_obj;
#if defined(HAS_SCREEN)
  extern Display display_obj;
#endif
extern Settings settings_obj;

namespace {
String csiScreenName(String value) {
  if (!settings_obj.loadSetting<bool>("Censor")) return value;
  for (size_t i = 3; i < value.length(); ++i) value.setCharAt(i, 'X');
  return value;
}
}

bool CsiMotionMonitor::takeWiFi() {
  if (wifi_scan_obj.currentScanMode != WIFI_SCAN_OFF)
    wifi_scan_obj.StopScan(wifi_scan_obj.currentScanMode);
  wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
  init.csi_enable = true;
  esp_err_t result = esp_wifi_init(&init);
  if (result == ESP_ERR_WIFI_INIT_STATE) {
    esp_wifi_stop();
    esp_wifi_deinit();
    result = esp_wifi_init(&init);
  }
  if (result != ESP_OK)
    return false;
  wifi_owned_ = true;
  if (esp_wifi_set_mode(WIFI_MODE_STA) != ESP_OK ||
      esp_wifi_start() != ESP_OK)
    return false;
  #if defined(CONFIG_IDF_TARGET_ESP32C5)
    wifi_promiscuous_filter_t filter = {};
    filter.filter_mask = WIFI_PROMIS_FILTER_MASK_MGMT | WIFI_PROMIS_FILTER_MASK_DATA |
                         WIFI_PROMIS_FILTER_MASK_DATA_MPDU | WIFI_PROMIS_FILTER_MASK_DATA_AMPDU;
    if (esp_wifi_set_ps(WIFI_PS_NONE) != ESP_OK ||
        esp_wifi_set_promiscuous_filter(&filter) != ESP_OK ||
        esp_wifi_set_promiscuous_rx_cb(&CsiMotionMonitor::countRadioFrame) != ESP_OK)
      return false;
  #endif
  if (esp_wifi_set_promiscuous(true) != ESP_OK ||
      esp_wifi_set_channel(channel_, WIFI_SECOND_CHAN_NONE) != ESP_OK)
    return false;

  return enableCSI();
}

bool CsiMotionMonitor::enableCSI() {
  wifi_csi_config_t config = {};
  #if !CONFIG_SOC_WIFI_HE_SUPPORT
    config.lltf_en = true;
    // Keep one stable 64-tone layout across legacy and HT packets. Mixing
    // HT-LTF/STBC blocks changes vector length and breaks window continuity.
    config.htltf_en = false;
    config.stbc_htltf2_en = false;
    config.ltf_merge_en = false;
    config.channel_filter_en = false;
    config.manu_scale = false;
    config.shift = 0;
    #if ESP_IDF_VERSION_MAJOR >= 5
      config.dump_ack_en = false;
    #endif
  #else
    config.enable = 1;
    config.acquire_csi_legacy = 1;
    #if CONFIG_SOC_WIFI_MAC_VERSION_NUM == 3
      // C5 can force the same L-LTF shape for legacy, HT, VHT and HE frames.
      config.acquire_csi_force_lltf = 1;
      config.acquire_csi_ht20 = 1;
      config.acquire_csi_ht40 = 1;
      config.acquire_csi_vht = 1;
      config.acquire_csi_su = 1;
      config.acquire_csi_mu = 1;
      config.acquire_csi_dcm = 1;
      config.acquire_csi_beamformed = 1;
      config.acquire_csi_he_stbc_mode = ESP_CSI_ACQUIRE_STBC_HELTF1;
    #else
      // C6 cannot force L-LTF for every modulation. Restrict capture to
      // legacy frames so every one-second motion window has one tone layout.
      config.acquire_csi_ht20 = 0;
      config.acquire_csi_ht40 = 0;
      config.acquire_csi_su = 0;
      config.acquire_csi_mu = 0;
      config.acquire_csi_dcm = 0;
      config.acquire_csi_beamformed = 0;
      config.acquire_csi_he_stbc = ESP_CSI_ACQUIRE_STBC_HELTF1;
    #endif
    config.val_scale_cfg = 0;
    config.dump_ack_en = 0;
  #endif
  if (esp_wifi_set_csi_rx_cb(&CsiMotionMonitor::callback, this) != ESP_OK ||
      esp_wifi_set_csi_config(&config) != ESP_OK ||
      esp_wifi_set_csi(true) != ESP_OK)
    return false;
  wifi_scan_obj.wifi_initialized = true;
  return true;
}

void CsiMotionMonitor::releaseWiFi() {
  #if defined(CONFIG_IDF_TARGET_ESP32C5)
    if (gateway_test_) {
      if (ping_session_) {
        esp_ping_stop(ping_session_);
        esp_ping_delete_session(ping_session_);
        ping_session_ = nullptr;
      }
      esp_wifi_set_csi(false);
      esp_wifi_set_csi_rx_cb(nullptr, nullptr);
      esp_wifi_set_ps(saved_ps_);
      if (test_station_owned_) {
        WiFi.mode(WIFI_OFF);
        wifi_scan_obj.wifi_initialized = false;
        wifi_scan_obj.wifi_connected = false;
      }
      gateway_test_ = test_station_owned_ = false;
      return;
    }
  #endif
  if (!wifi_owned_)
    return;
  esp_wifi_set_csi(false);
  esp_wifi_set_csi_rx_cb(nullptr, nullptr);
  esp_wifi_set_promiscuous(false);
  #if defined(CONFIG_IDF_TARGET_ESP32C5)
    esp_wifi_set_promiscuous_rx_cb(nullptr);
  #endif
  esp_wifi_stop();
  esp_wifi_deinit();
  wifi_owned_ = false;
  wifi_scan_obj.wifi_initialized = false;
}

bool CsiMotionMonitor::start(const uint8_t target[6], const String& name,
                             uint8_t channel) {
  stop();
  return startSession(target, name, channel);
}

#if defined(CONFIG_IDF_TARGET_ESP32C5)
// Associate with the selected radio using its saved profile for a bounded link test.
// 用板内保存的配置连接指定接入点，进行限时链路自测。
bool CsiMotionMonitor::startGatewayTest(const uint8_t target[6], const String& name, uint8_t channel) {
  auto fail = [](const char* reason) {
    Serial.printf("CSI self-test failed: %s\n", reason);
    return false;
  };
  if (active_ || (wifi_scan_obj.currentScanMode != WIFI_SCAN_OFF &&
                  wifi_scan_obj.currentScanMode != WIFI_CONNECTED)) return fail("radio busy");
  const bool connected = WiFi.status() == WL_CONNECTED;
  if (!connected) {
    String ssid, password;
    bool found = false;
    const uint8_t count = settings_obj.getSavedWifiCount();
    for (uint8_t i = 0; i < count; ++i) {
      if (settings_obj.loadSavedWifiCredential(i, ssid, password) && ssid == name) {
        found = true;
        break;
      }
    }
    if (!found) return fail("no saved profile for this SSID");
    if (!WiFi.mode(WIFI_STA)) return fail("station unavailable");
    WiFi.begin(name.c_str(), password.c_str(), channel, target);
    const uint32_t since = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - since < 12000) delay(50);
  }
  wifi_ap_record_t current = {};
  if (WiFi.status() != WL_CONNECTED || esp_wifi_sta_get_ap_info(&current) != ESP_OK ||
      memcmp(current.bssid, target, 6) != 0 || current.primary != channel || WiFi.SSID() != name) {
    if (!connected) WiFi.mode(WIFI_OFF);
    return fail("selected station link not established");
  }
  gateway_test_ = true;
  test_station_owned_ = !connected;
  if (esp_wifi_get_ps(&saved_ps_) != ESP_OK || esp_wifi_set_ps(WIFI_PS_NONE) != ESP_OK ||
      !startSession(target, name, channel)) {
    releaseWiFi();
    return fail("CSI or gateway unavailable");
  }
  return true;
}

// Bind echo requests to the station interface and its DHCP gateway for 60 seconds.
// 在 60 秒内通过当前 Wi-Fi 接口向 DHCP 网关发送回显请求。
bool CsiMotionMonitor::startGatewayPing() {
  esp_netif_t* sta = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
  esp_netif_ip_info_t ip = {};
  esp_netif_dhcp_status_t dhcp;
  if (!sta || esp_netif_get_ip_info(sta, &ip) != ESP_OK || !ip.gw.addr ||
      esp_netif_dhcpc_get_status(sta, &dhcp) != ESP_OK || dhcp != ESP_NETIF_DHCP_STARTED ||
      !ip.ip.addr || !ip.netmask.addr || ip.ip.addr == ip.gw.addr ||
      ((ip.ip.addr ^ ip.gw.addr) & ip.netmask.addr)) return false;
  const uint32_t gateway = ntohl(ip.gw.addr);
  const uint32_t hosts = ~ntohl(ip.netmask.addr);
  if ((gateway >> 24) == 0 || (gateway >> 24) == 127 || (gateway >> 28) >= 14 ||
      (hosts > 1 && ((gateway & hosts) == 0 || (gateway & hosts) == hosts))) return false;
  const int index = esp_netif_get_netif_impl_index(sta);
  if (index <= 0) return false;
  esp_ping_config_t ping = ESP_PING_DEFAULT_CONFIG();
  ping.count = 300;
  ping.interval_ms = 200;
  ping.timeout_ms = 150;
  ping.data_size = 32;
  ping.ttl = 1;
  ping.interface = index;
  ip_addr_set_ip4_u32(&ping.target_addr, ip.gw.addr);
  esp_ping_callbacks_t callbacks = {};
  test_started_ms_ = millis();
  return esp_ping_new_session(&ping, &callbacks, &ping_session_) == ESP_OK &&
         esp_ping_start(ping_session_) == ESP_OK;
}
#endif

bool CsiMotionMonitor::startSession(const uint8_t target[6], const String& name, uint8_t channel) {
  if (!allocateQueue())
    return false;
  memcpy(target_, target, sizeof(target_));
  target_name_ = name;
  channel_ = channel;
  target_count_ = 1;
  targets_ = static_cast<Target*>(ps_malloc(sizeof(Target) * target_count_));
  if (!targets_)
    targets_ = static_cast<Target*>(malloc(sizeof(Target) * target_count_));
  if (!targets_) {
    target_count_ = 0;
    releaseQueue();
    return false;
  }
  Target* target_state = new (&targets_[0]) Target();
  memcpy(target_state->bssid, target_, sizeof(target_state->bssid));
  target_state->accepted = target_state->dropped = 0;
  target_state->model.reset(millis(), 30000);
  write_index_ = read_index_ = 0;
  accepted_ = dropped_ = 0;
  started_ms_ = millis();
  last_fusion_ms_ = started_ms_;
  motion_score_ = amplitude_score_ = phase_score_ = correlation_score_ = 0;
  reliability_ = 0;
  samples_per_second_ = 0;
  motion_votes_ = still_votes_ = 0;
  state_ = CsiMotionModel::State::CALIBRATING;
  last_serial_ms_ = 0;
  memset(history_, 0, sizeof(history_));
  history_head_ = 0;
  #if defined(CONFIG_IDF_TARGET_ESP32C5)
    raw_callbacks_ = target_other_ = target_11b_ = 0;
    downlink_ = uplink_ = target_callbacks_ = 0;
    secondary_offset_ = -1;
  #endif
  #if defined(CONFIG_IDF_TARGET_ESP32C5)
    const bool ready = gateway_test_ ? (enableCSI() && startGatewayPing()) : takeWiFi();
  #else
    const bool ready = takeWiFi();
  #endif
  if (!ready) {
    releaseWiFi();
    releaseTargets();
    releaseQueue();
    return false;
  }
  active_ = true;
  wifi_scan_obj.currentScanMode = WIFI_SCAN_CSI_MOTION;
  #if defined(HAS_SCREEN)
    display_obj.tft.fillRect(0, STATUS_BAR_WIDTH, SCREEN_WIDTH,
                             SCREEN_HEIGHT - STATUS_BAR_WIDTH, TFT_BLACK);
    draw(millis());
  #endif
  Serial.printf("CSI motion started: AP=\"%s\" BSSID=%02X:%02X:%02X:%02X:%02X:%02X channel=%u; keep the device still for 30 seconds. Stop with stopscan.\n",
      target_name_.c_str(), target_[0], target_[1], target_[2], target_[3],
      target_[4], target_[5], channel_);
  return true;
}

void CsiMotionMonitor::stop() {
  active_ = false;
  releaseWiFi();
  releaseTargets();
  releaseQueue();
  if (wifi_scan_obj.currentScanMode == WIFI_SCAN_CSI_MOTION)
    wifi_scan_obj.currentScanMode = WIFI_SCAN_OFF;
}

void CsiMotionMonitor::recalibrate() {
  write_index_ = read_index_ = 0;
  accepted_ = dropped_ = 0;
  started_ms_ = millis();
  for (uint16_t i = 0; i < target_count_; ++i) {
    targets_[i].accepted = targets_[i].dropped = 0;
    targets_[i].model.reset(started_ms_, 30000);
  }
  motion_score_ = amplitude_score_ = phase_score_ = correlation_score_ = 0;
  reliability_ = 0;
  samples_per_second_ = 0;
  state_ = CsiMotionModel::State::CALIBRATING;
  last_serial_ms_ = 0;
  memset(history_, 0, sizeof(history_));
  history_head_ = 0;
}

void CsiMotionMonitor::callback(void* context, wifi_csi_info_t* info) {
  if (context && info)
    static_cast<CsiMotionMonitor*>(context)->enqueue(info);
}

#if defined(CONFIG_IDF_TARGET_ESP32C5)
// Classify management and data frames from the selected transmitter.
// 按调制类型统计所选发射端的管理帧和数据帧。
void CsiMotionMonitor::countRadioFrame(void* buffer, wifi_promiscuous_pkt_type_t type) {
  if (!buffer || (type != WIFI_PKT_MGMT && type != WIFI_PKT_DATA)) return;
  auto& monitor = csi_motion_obj;
  auto packet = static_cast<const wifi_promiscuous_pkt_t*>(buffer);
  const uint8_t* hdr = packet->payload;
  if (!monitor.active_ || packet->rx_ctrl.sig_len < 28 || packet->rx_ctrl.rx_state != 0) return;
  const bool data = type == WIFI_PKT_DATA && (hdr[0] & 0x4c) == 0x08;
  if (data && (hdr[1] & 3) == 1 && !memcmp(hdr + 4, monitor.target_, 6)) ++monitor.uplink_;
  if (memcmp(hdr + 10, monitor.target_, 6) != 0) return;
  if (data && (hdr[1] & 3) == 2) ++monitor.downlink_;
  // The selected AP's HT Operation element reports its secondary channel.
  // 从所选接入点的信标读取扩展信道的位置。
  if (type == WIFI_PKT_MGMT && hdr[0] == 0x80 && monitor.secondary_offset_ < 0) {
    const size_t end = packet->rx_ctrl.sig_len - 4;
    for (size_t i = 36; i + 2 <= end; ) {
      const size_t len = hdr[i + 1];
      if (i + 2 + len > end) break;
      if (hdr[i] == 61 && len >= 2 && hdr[i + 2] == monitor.channel_) {
        monitor.secondary_offset_ = (hdr[i + 3] & 4) ? hdr[i + 3] & 3 : 0;
        break;
      }
      i += 2 + len;
    }
  }
  if (packet->rx_ctrl.cur_bb_format == RX_BB_FORMAT_11B) ++monitor.target_11b_;
  else ++monitor.target_other_;
}
#endif

void CsiMotionMonitor::enqueue(wifi_csi_info_t* info) {
  if (!active_ || !queue_)
    return;
  #if defined(CONFIG_IDF_TARGET_ESP32C5)
    ++raw_callbacks_;
  #endif
  const uint8_t* transmitter = info->mac;
  #if defined(CONFIG_IDF_TARGET_ESP32C5)
    if (info->hdr && info->rx_ctrl.sig_len >= 28 && (info->hdr[0] & 0x0c) == 0x08 &&
        (info->hdr[1] & 3) == 2)
      transmitter = info->hdr + 10;
  #endif
  const int target_index = findTarget(transmitter);
  if (target_index < 0) return;
  #if defined(CONFIG_IDF_TARGET_ESP32C5)
    ++target_callbacks_;
  #endif
  if (!info->buf || info->len < 16) return;
  const uint8_t next = static_cast<uint8_t>((write_index_ + 1) % kQueueSize);
  if (next == read_index_) {
    ++dropped_;
    ++targets_[target_index].dropped;
    return;
  }
  Sample& sample = queue_[write_index_];
  sample.target_index = static_cast<uint16_t>(target_index);
  sample.length = info->len > kMaxCsiBytes ? kMaxCsiBytes : info->len;
  sample.rssi = info->rx_ctrl.rssi;
  sample.first_word_invalid = info->first_word_invalid;
  sample.timestamp = millis();
  memcpy(sample.iq, info->buf, sample.length);
  write_index_ = next;
  ++accepted_;
  ++targets_[target_index].accepted;
}

int CsiMotionMonitor::findTarget(const uint8_t mac[6]) const {
  for (uint16_t i = 0; i < target_count_; ++i) {
    if (memcmp(mac, targets_[i].bssid, 6) == 0)
      return i;
  }
  return -1;
}

bool CsiMotionMonitor::allocateQueue() {
  if (queue_)
    return true;
  const size_t bytes = sizeof(Sample) * kQueueSize;
  queue_ = static_cast<Sample*>(ps_malloc(bytes));
  if (!queue_ && marauder::RuntimeMemoryGuard::instance().allow(bytes))
    queue_ = static_cast<Sample*>(malloc(bytes));
  if (!queue_)
    return false;
  memset(queue_, 0, bytes);
  return true;
}

void CsiMotionMonitor::releaseQueue() {
  free(queue_);
  queue_ = nullptr;
  write_index_ = read_index_ = 0;
}

void CsiMotionMonitor::releaseTargets() {
  if (!targets_) {
    target_count_ = 0;
    return;
  }
  for (uint16_t i = 0; i < target_count_; ++i)
    targets_[i].~Target();
  free(targets_);
  targets_ = nullptr;
  target_count_ = 0;
  active_target_count_ = 0;
}

const char* CsiMotionMonitor::stateLabel() const {
  switch (state_) {
    case CsiMotionModel::State::CALIBRATING: return "CALIBRATING";
    case CsiMotionModel::State::INSUFFICIENT_SAMPLES: return "LOW DATA";
    case CsiMotionModel::State::POSSIBLE_MOTION: return "POSSIBLE";
    case CsiMotionModel::State::MOTION: return "MOTION";
    case CsiMotionModel::State::STILL: return "STILL";
  }
  return "UNKNOWN";
}

void CsiMotionMonitor::drawGraph() {
  #if !defined(HAS_SCREEN)
    return;
  #else
  #if SCREEN_HEIGHT <= 160
    const int graph_y = STATUS_BAR_WIDTH + 62;
    const int graph_h = SCREEN_HEIGHT - graph_y;
  #else
    const int content_height = SCREEN_HEIGHT - STATUS_BAR_WIDTH;
    const int graph_y = STATUS_BAR_WIDTH + content_height / 2;
    const int graph_h = SCREEN_HEIGHT - graph_y - 18;
  #endif
  display_obj.tft.fillRect(0, graph_y, SCREEN_WIDTH, graph_h, TFT_BLACK);
  display_obj.tft.drawRect(0, graph_y, SCREEN_WIDTH, graph_h, TFT_DARKGREY);
  const uint8_t* history = history_;
  const size_t head = history_head_;
  for (int x = 1; x < SCREEN_WIDTH; ++x) {
    const size_t offset =
        (static_cast<size_t>(SCREEN_WIDTH - x) * CsiMotionModel::kHistorySize) /
        SCREEN_WIDTH;
    size_t a = (head + CsiMotionModel::kHistorySize - offset - 1) %
               CsiMotionModel::kHistorySize;
    size_t b = (a + 1) % CsiMotionModel::kHistorySize;
    if (history[a] == 255 || history[b] == 255)
      continue;
    int y1 = graph_y + graph_h - 2 - (history[a] * (graph_h - 4) / 100);
    int y2 = graph_y + graph_h - 2 - (history[b] * (graph_h - 4) / 100);
    display_obj.tft.drawLine(x - 1, y1, x, y2,
                            history[b] >= CsiMotionModel::kMotionThreshold
                                ? TFT_RED : TFT_CYAN);
  }
  int threshold_y = graph_y + graph_h - 2 -
      (CsiMotionModel::kMotionThreshold * (graph_h - 4) / 100);
  display_obj.tft.drawFastHLine(1, threshold_y, SCREEN_WIDTH - 2, TFT_ORANGE);
  #endif
}

void CsiMotionMonitor::draw(uint32_t now_ms) {
  #if !defined(HAS_SCREEN)
    (void)now_ms;
    return;
  #elif SCREEN_HEIGHT <= 160
  const int graph_y = STATUS_BAR_WIDTH + 62;
  const int title_y = STATUS_BAR_WIDTH + 1;
  display_obj.tft.fillRect(0, STATUS_BAR_WIDTH, SCREEN_WIDTH,
                           graph_y - STATUS_BAR_WIDTH, TFT_BLACK);
  display_obj.tft.setTextSize(1);
  display_obj.tft.setTextColor(TFT_CYAN, TFT_BLACK);
  display_obj.tft.setCursor(2, title_y);
  display_obj.tft.print("CSI Motion");
  display_obj.tft.setTextColor(TFT_WHITE, TFT_BLACK);
  display_obj.tft.setCursor(2, title_y + 10);
  const String display_target = csiScreenName(target_name_);
  display_obj.tft.printf("AP:%.12s C:%u", display_target.c_str(), channel_);
  display_obj.tft.setCursor(2, title_y + 20);
  if (now_ms - started_ms_ < 30000) {
    display_obj.tft.printf("M:%u R:%u CAL:%u%%", motion_score_, reliability_,
        static_cast<unsigned>((now_ms - started_ms_) * 100U / 30000U));
  } else {
    display_obj.tft.printf("M:%u R:%u %s", motion_score_, reliability_, stateLabel());
  }
  display_obj.tft.setCursor(2, title_y + 30);
  display_obj.tft.printf("A:%u P:%u C:%u", amplitude_score_, phase_score_,
      correlation_score_);
  display_obj.tft.setCursor(2, title_y + 40);
  display_obj.tft.printf("Rate:%u D:%lu", samples_per_second_,
      static_cast<unsigned long>(dropped_));
  display_obj.tft.setTextColor(TFT_DARKGREY, TFT_BLACK);
  display_obj.tft.setCursor(2, title_y + 50);
  display_obj.tft.print("Up=Cal C=Stop");
  #else
  const int content_height = SCREEN_HEIGHT - STATUS_BAR_WIDTH;
  const int graph_y = STATUS_BAR_WIDTH + content_height / 2;
  const int title_y = STATUS_BAR_WIDTH + 2;
  display_obj.tft.fillRect(0, STATUS_BAR_WIDTH, SCREEN_WIDTH,
                           graph_y - STATUS_BAR_WIDTH, TFT_BLACK);
  display_obj.tft.setTextSize(1);
  display_obj.tft.setTextColor(TFT_CYAN, TFT_BLACK);
  display_obj.tft.setCursor(2, title_y);
  display_obj.tft.print("CSI Motion Monitor");
  display_obj.tft.setTextColor(TFT_WHITE, TFT_BLACK);
  display_obj.tft.setCursor(2, title_y + 14);
  const String display_target = csiScreenName(target_name_);
  display_obj.tft.printf("AP: %.16s CH:%u", display_target.c_str(), channel_);
  display_obj.tft.setCursor(2, title_y + 26);
  display_obj.tft.printf("Rate:%u/s Drop:%lu", samples_per_second_,
      static_cast<unsigned long>(dropped_));
  display_obj.tft.setCursor(2, title_y + 38);
  display_obj.tft.printf("Motion:%u Reliability:%u", motion_score_, reliability_);
  display_obj.tft.setCursor(2, title_y + 50);
  display_obj.tft.printf("Amp:%u Phase:%u Corr:%u", amplitude_score_,
      phase_score_, correlation_score_);
  display_obj.tft.setCursor(2, title_y + 62);
  display_obj.tft.printf("State: %s", stateLabel());
  if (now_ms - started_ms_ < 30000) {
    display_obj.tft.setCursor(2, title_y + 74);
    display_obj.tft.printf("Keep still: %u%%",
        static_cast<unsigned>((now_ms - started_ms_) * 100U / 30000U));
  }
  display_obj.tft.setTextColor(TFT_DARKGREY, TFT_BLACK);
  display_obj.tft.setCursor(2, graph_y - 12);
  #if defined(HAS_CSI_BUTTON_CONTROLS)
    display_obj.tft.print("Up=Recalibrate Center=Stop");
  #else
    display_obj.tft.print("Top=Recalibrate Bottom=Stop");
  #endif
  #endif
  drawGraph();
}

void CsiMotionMonitor::printStatus(bool force) {
  const uint32_t now_ms = millis();
  if (!force && now_ms - last_serial_ms_ < 1000) return;
  last_serial_ms_ = now_ms;
  const uint8_t calibration = now_ms - started_ms_ >= 30000 ? 100 :
      static_cast<uint8_t>((now_ms - started_ms_) * 100U / 30000U);
  Serial.printf(
      "CSI motion | state=%s | motion=%u | reliability=%u | amp=%u | phase=%u | corr=%u | rate=%u/s | dropped=%lu | calibration=%u%% | AP=\"%s\" | channel=%u",
      stateLabel(), motion_score_, reliability_, amplitude_score_, phase_score_,
      correlation_score_, samples_per_second_,
      static_cast<unsigned long>(dropped_), calibration, target_name_.c_str(),
      channel_);
  #if defined(CONFIG_IDF_TARGET_ESP32C5)
    const uint32_t legacy = target_11b_;
    Serial.printf(" | target_frames=%lu | legacy_11b=%lu | csi_callbacks=%lu",
        (unsigned long)(legacy + target_other_), (unsigned long)legacy,
        (unsigned long)raw_callbacks_);
    Serial.printf(" | down=%lu | up=%lu | ht_offset=%d | target_csi=%lu | accepted=%lu",
        (unsigned long)downlink_, (unsigned long)uplink_, secondary_offset_,
        (unsigned long)target_callbacks_, (unsigned long)accepted_);
    if (ping_session_) {
      uint32_t sent = 0, replies = 0;
      esp_ping_get_profile(ping_session_, ESP_PING_PROF_REQUEST, &sent, sizeof(sent));
      esp_ping_get_profile(ping_session_, ESP_PING_PROF_REPLY, &replies, sizeof(replies));
      Serial.printf(" | gateway_sent=%lu | gateway_replies=%lu", (unsigned long)sent, (unsigned long)replies);
    }
  #endif
  Serial.println();
}

void CsiMotionMonitor::updateFusion(uint32_t now_ms) {
  if (now_ms - last_fusion_ms_ < 1000)
    return;
  last_fusion_ms_ = now_ms;
  struct Candidate { uint8_t score, amp, phase, corr, reliability; };
  Candidate best[3] = {};
  uint32_t reliability_sum = 0;
  uint32_t total_rate = 0;
  active_target_count_ = 0;
  for (uint16_t i = 0; i < target_count_; ++i) {
    CsiMotionModel& model = targets_[i].model;
    model.tick(now_ms, targets_[i].accepted, targets_[i].dropped);
    total_rate += model.samplesPerSecond();
    if (!model.calibrated() || model.reliability() < 25)
      continue;
    ++active_target_count_;
    reliability_sum += model.reliability();
    Candidate candidate = {model.motionScore(), model.amplitudeScore(),
        model.phaseScore(), model.correlationScore(), model.reliability()};
    for (size_t slot = 0; slot < 3; ++slot) {
      if (candidate.score > best[slot].score) {
        for (size_t move = 2; move > slot; --move) best[move] = best[move - 1];
        best[slot] = candidate;
        break;
      }
    }
  }
  samples_per_second_ = static_cast<uint16_t>(total_rate > 65535 ? 65535 : total_rate);
  reliability_ = active_target_count_ ? static_cast<uint8_t>(reliability_sum / active_target_count_) : 0;
  uint32_t weight_sum = 0, motion_sum = 0, amp_sum = 0, phase_sum = 0, corr_sum = 0;
  for (size_t i = 0; i < 3 && best[i].reliability; ++i) {
    const uint32_t weight = best[i].reliability;
    weight_sum += weight;
    motion_sum += best[i].score * weight;
    amp_sum += best[i].amp * weight;
    phase_sum += best[i].phase * weight;
    corr_sum += best[i].corr * weight;
  }
  motion_score_ = weight_sum ? motion_sum / weight_sum : 0;
  amplitude_score_ = weight_sum ? amp_sum / weight_sum : 0;
  phase_score_ = weight_sum ? phase_sum / weight_sum : 0;
  correlation_score_ = weight_sum ? corr_sum / weight_sum : 0;
  if (now_ms - started_ms_ < 30000) {
    state_ = CsiMotionModel::State::CALIBRATING;
  } else if (!active_target_count_) {
    state_ = CsiMotionModel::State::INSUFFICIENT_SAMPLES;
  } else if (motion_score_ >= CsiMotionModel::kMotionThreshold) {
    motion_votes_ = motion_votes_ < 5 ? motion_votes_ + 1 : 5;
    still_votes_ = 0;
    state_ = motion_votes_ >= 2 ? CsiMotionModel::State::MOTION :
                                  CsiMotionModel::State::POSSIBLE_MOTION;
  } else if (motion_score_ >= CsiMotionModel::kPossibleMotionThreshold) {
    motion_votes_ = still_votes_ = 0;
    state_ = CsiMotionModel::State::POSSIBLE_MOTION;
  } else {
    motion_votes_ = 0;
    still_votes_ = still_votes_ < 3 ? still_votes_ + 1 : 3;
    if (still_votes_ >= 2) state_ = CsiMotionModel::State::STILL;
  }
  history_[history_head_] = reliability_ < 15 ? 255 : motion_score_;
  history_head_ = (history_head_ + 1) % CsiMotionModel::kHistorySize;
}

void CsiMotionMonitor::main() {
  if (!active_)
    return;
  while (read_index_ != write_index_) {
    Sample& sample = queue_[read_index_];
    if (sample.target_index < target_count_) {
      targets_[sample.target_index].model.addSample(
          sample.iq, sample.length, sample.rssi, sample.timestamp,
          sample.first_word_invalid,
          #if defined(CONFIG_IDF_TARGET_ESP32C5)
            CsiMotionModel::SampleEncoding::SIGNED_12_LE
          #else
            CsiMotionModel::SampleEncoding::SIGNED_8_IMAG_REAL
          #endif
          );
    }
    read_index_ = static_cast<uint8_t>((read_index_ + 1) % kQueueSize);
  }
  // Tick after startup and after all queued sample timestamps.
  // 用采样队列处理完毕后的时间更新窗口。
  const uint32_t now_ms = millis();
  updateFusion(now_ms);
  #if defined(CONFIG_IDF_TARGET_ESP32C5)
    if (gateway_test_ && (now_ms - test_started_ms_ >= 60000 || WiFi.status() != WL_CONNECTED)) {
      printStatus(true);
      const bool completed = now_ms - test_started_ms_ >= 60000;
      stop();
      Serial.println(completed ? F("CSI self-test complete") : F("CSI self-test failed: station disconnected"));
      return;
    }
  #endif
  printStatus(false);
  #if defined(HAS_SCREEN)
  if (now_ms - last_draw_ms_ >= 500) {
    last_draw_ms_ = now_ms;
    draw(now_ms);
  }
  #endif
}

#endif
