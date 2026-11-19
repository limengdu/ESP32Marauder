#include <unity.h>
#include "BleSurvey.h"

void setUp() {}
void tearDown() {}

using marauder::BleSurveySample;
using marauder::BleSurveySamples;

void test_received_reports_keep_their_address_time_and_signal() {
  BleSurveySamples samples;
  const uint8_t first[] = {0xf6, 0xe5, 0xd4, 0xc3, 0xb2, 0xa1};
  const uint8_t second[] = {0x07, 0xe5, 0xd4, 0xc3, 0xb2, 0xa1};
  BleSurveySample sample;
  char line[48];
  samples.receive(100, first, -61);
  samples.receive(101, second, -72);
  TEST_ASSERT_TRUE(samples.take(102, sample));
  sample.format(line);
  TEST_ASSERT_EQUAL_STRING("BLE,100,A1:B2:C3:D4:E5:F6,-61", line);
  TEST_ASSERT_TRUE(samples.take(102, sample));
  sample.format(line);
  TEST_ASSERT_EQUAL_STRING("BLE,101,A1:B2:C3:D4:E5:07,-72", line);
  samples.receive(599, first, -63);
  TEST_ASSERT_FALSE(samples.take(599, sample));
  TEST_ASSERT_FALSE(samples.take(600, sample));
  samples.receive(600, first, -65);
  TEST_ASSERT_TRUE(samples.take(601, sample));
  sample.format(line);
  TEST_ASSERT_EQUAL_STRING("BLE,600,A1:B2:C3:D4:E5:F6,-65", line);
  TEST_ASSERT_FALSE(samples.take(5000, sample));
}

void test_changing_addresses_cannot_exhaust_serial_bandwidth() {
  BleSurveySamples samples;
  BleSurveySample sample;
  uint8_t address[6] = {};
  unsigned count = 0;
  for (unsigned i = 0; i < 250; ++i) {
    address[0] = i;
    samples.receive(1, address, -45);
    if (samples.take(1, sample)) ++count;
  }
  TEST_ASSERT_EQUAL_UINT(16, count);
  samples.receive(500, address, -50);
  TEST_ASSERT_FALSE(samples.take(500, sample));
  samples.receive(501, address, -52);
  TEST_ASSERT_TRUE(samples.take(501, sample));
  TEST_ASSERT_EQUAL_INT(-52, sample.rssi);
}

void test_clock_wrap_invalid_rssi_and_restart() {
  BleSurveySamples samples;
  BleSurveySample sample;
  uint8_t address[6] = {};
  samples.receive(UINT32_MAX - 20, address, 127);
  TEST_ASSERT_FALSE(samples.take(UINT32_MAX, sample));
  samples.receive(UINT32_MAX - 20, address, -60);
  TEST_ASSERT_TRUE(samples.take(0, sample));
  samples.receive(478, address, -57);
  TEST_ASSERT_FALSE(samples.take(478, sample));
  samples.receive(479, address, -56);
  TEST_ASSERT_TRUE(samples.take(479, sample));
  samples.receive(1000, address, -55);
  samples.clear();
  TEST_ASSERT_FALSE(samples.take(1001, sample));
  samples.receive(1001, address, -54);
  TEST_ASSERT_TRUE(samples.take(1002, sample));
  TEST_ASSERT_EQUAL_INT(-54, sample.rssi);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_received_reports_keep_their_address_time_and_signal);
  RUN_TEST(test_changing_addresses_cannot_exhaust_serial_bandwidth);
  RUN_TEST(test_clock_wrap_invalid_rssi_and_restart);
  return UNITY_END();
}
