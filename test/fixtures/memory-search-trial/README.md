# Memory search trial samples

All ten stories are fictional and written for this experiment. IDs and filenames deliberately avoid descriptive search terms. Titles are used by the simple keyword comparison; DigUp reads the original story content and neutral filenames.

The two photos are public sample images, not Memento user data:

- `p01.png`: NASA portrait of astronaut Eileen Collins, public domain. Obtained unchanged from [scikit-image v0.24.0](https://github.com/scikit-image/scikit-image/blob/v0.24.0/skimage/data/astronaut.png).
- `p02.png`: Chelsea the cat, photograph by Stefan van der Walt, CC0. Obtained unchanged from [scikit-image v0.24.0](https://github.com/scikit-image/scikit-image/blob/v0.24.0/skimage/data/chelsea.png).

The origins and usage terms are recorded in [scikit-image's data documentation](https://github.com/scikit-image/scikit-image/blob/v0.24.0/skimage/data/_fetchers.py), in `astronaut()` and `chelsea()`.

`collection.json` specifies the only files the trial may read and the expected answer for each query. An empty `expected` array means that no result should be returned. Those cases measure unwanted matches; they are never counted as positive-search successes.

The small collection is a smoke test. It cannot establish recognition of family members, reliable multilingual search, production scalability or retrieval quality on a real family archive. Identity and relationships need explicit metadata or user confirmation, not visual similarity alone.
