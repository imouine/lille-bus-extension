import unittest

from scripts.build_schedules import extract_city, is_boardable_stop_time, station_label


class StopTimeFilteringTests(unittest.TestCase):
    def test_intermediate_stop_is_kept(self):
        self.assertTrue(is_boardable_stop_time({"stop_sequence": "4", "pickup_type": "0"}, 8))

    def test_final_stop_is_excluded_even_when_pickup_type_is_missing(self):
        self.assertFalse(is_boardable_stop_time({"stop_sequence": "8", "pickup_type": ""}, 8))

    def test_no_pickup_stop_is_excluded(self):
        self.assertFalse(is_boardable_stop_time({"stop_sequence": "4", "pickup_type": "1"}, 8))

    def test_invalid_sequence_is_excluded(self):
        self.assertFalse(is_boardable_stop_time({"stop_sequence": ""}, 8))

    def test_city_is_extracted_from_gtfs_description(self):
        self.assertEqual(extract_city("MARCQ MAIRIE 59700 MARCQ EN BAROEUL"), "MARCQ EN BAROEUL")

    def test_duplicate_station_label_contains_city(self):
        self.assertEqual(
            station_label("Mairie", "Marcq-en-Baroeul", duplicate_name=True),
            "MAIRIE — MARCQ-EN-BAROEUL",
        )


if __name__ == "__main__":
    unittest.main()
