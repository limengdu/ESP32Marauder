#pragma once

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

namespace marauder {
struct BleSurveySample {
  uint32_t received_ms;
  uint8_t address[6];  // NimBLE byte order / NimBLE 地址字节序
  int8_t rssi;

  void format(char (&line)[48]) const {
    snprintf(line, sizeof(line), "BLE,%lu,%02X:%02X:%02X:%02X:%02X:%02X,%d",
             static_cast<unsigned long>(received_ms), address[5], address[4], address[3],
             address[2], address[1], address[0], rssi);
  }
};

// Each slot holds one received report and its address's 500 ms cooldown.
// 每个槽位保存一次实收样本，并记录该地址的 500 毫秒输出间隔。
class BleSurveySamples {
 public:
  void clear() { count_ = 0; }

  void receive(uint32_t now, const uint8_t address[6], int8_t rssi) {
    if (rssi < -127 || rssi > 20) return;
    size_t slot = count_;
    for (size_t i = 0; i < count_; ++i) {
      const bool available = !slots_[i].pending && now - slots_[i].sample.received_ms >= 500;
      if (memcmp(slots_[i].sample.address, address, 6) == 0) {
        if (!available) return;
        slot = i;
        break;
      }
      if (available && slot == count_) slot = i;
    }
    if (slot == count_) {
      if (count_ == capacity_) return;
      ++count_;
    }
    Slot& entry = slots_[slot];
    entry.sample.received_ms = now;
    memcpy(entry.sample.address, address, sizeof(entry.sample.address));
    entry.sample.rssi = rssi;
    entry.pending = true;
  }

  bool take(uint32_t now, BleSurveySample& sample) {
    size_t oldest = count_;
    for (size_t i = 0; i < count_; ++i) {
      if (slots_[i].pending && (oldest == count_ ||
          now - slots_[i].sample.received_ms > now - slots_[oldest].sample.received_ms)) {
        oldest = i;
      }
    }
    if (oldest == count_) return false;
    sample = slots_[oldest].sample;
    slots_[oldest].pending = false;
    return true;
  }

 private:
  struct Slot {
    BleSurveySample sample;
    bool pending;
  };
  static constexpr size_t capacity_ = 16;
  Slot slots_[capacity_];
  size_t count_ = 0;
};
}  // namespace marauder
