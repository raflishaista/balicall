"""Allowlisted model aliases and a bounded resident STT model cache.

Call get while holding the inference lock so another request cannot evict a
model that is still transcribing.
"""
import gc
from collections import OrderedDict


def model_sources(default_model, indonesian_path):
    sources = {default_model: default_model, "small": "small"}
    if indonesian_path:
        sources["small-id"] = indonesian_path
    elif default_model == "small-id":
        raise ValueError("WHISPER_SMALL_ID_PATH is required for small-id")
    return sources


class ModelRegistry:
    def __init__(self, sources, loader, capacity=1):
        if capacity not in (1, 2):
            raise ValueError('Model cache capacity must be 1 or 2')
        self.sources = sources
        self.loader = loader
        self.active = None
        self.instance = None
        self.capacity = capacity
        self.cache = OrderedDict()

    def get(self, alias):
        if alias not in self.sources:
            raise ValueError("Unsupported speech model")
        if alias != self.active:
            self.instance = None
            self.active = None
            if alias not in self.cache:
                if len(self.cache) >= self.capacity:
                    self.cache.popitem(last=False)
                    gc.collect()
                self.cache[alias] = self.loader(self.sources[alias])
            self.cache.move_to_end(alias)
            self.instance = self.cache[alias]
            self.active = alias
        return self.instance
