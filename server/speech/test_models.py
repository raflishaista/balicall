import unittest
from models import ModelRegistry, model_sources


class ModelTests(unittest.TestCase):
    def test_two_model_cache_avoids_reloads_on_switch(self):
        calls = []
        def load(source):
            calls.append(source)
            return object()
        registry = ModelRegistry({'small': 'small', 'small-id': 'id'}, load, capacity=2)
        small = registry.get('small')
        indonesian = registry.get('small-id')
        self.assertIs(registry.get('small'), small)
        self.assertIs(registry.get('small-id'), indonesian)
        self.assertEqual(calls, ['small', 'id'])

    def test_indonesian_requires_converted_checkpoint(self):
        self.assertNotIn("small-id", model_sources("small", ""))
        self.assertEqual(model_sources("small", "/models/id")["small-id"], "/models/id")
        with self.assertRaises(ValueError):
            model_sources("small-id", "")

    def test_switch_reuses_current_and_recovers_from_load_failure(self):
        calls = []
        def load(source):
            calls.append(source)
            if source == "broken":
                raise RuntimeError("missing weights")
            return object()
        registry = ModelRegistry({"small": "small", "small-id": "id", "bad": "broken"}, load)
        first = registry.get("small")
        self.assertIs(registry.get("small"), first)
        with self.assertRaises(ValueError):
            registry.get("unlisted")
        self.assertIs(registry.get("small"), first)
        registry.get("small-id")
        with self.assertRaises(RuntimeError):
            registry.get("bad")
        self.assertIsNone(registry.active)
        registry.get("small")
        self.assertEqual(calls, ["small", "id", "broken", "small"])


if __name__ == "__main__":
    unittest.main()
