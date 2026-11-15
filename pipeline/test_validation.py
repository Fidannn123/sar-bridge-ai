"""Meaningful edge cases for class-specific comparison metrics."""
import numpy as np
from validation_metrics import binary_scores


def main():
    a = lambda values: np.array(values, dtype=bool)
    score = binary_scores(a([1, 1, 0, 0]), a([1, 0, 1, 0]), a([1, 1, 1, 1]))
    assert [score[k] for k in ("tp_px", "fp_px", "fn_px", "tn_px")] == [1, 1, 1, 1]
    assert score["precision"] == score["recall"] == score["f1"] == .5
    assert score["iou"] == .333333
    no_prediction = binary_scores(a([0, 0]), a([1, 0]), a([1, 1]))
    assert no_prediction["precision"] is None and no_prediction["recall"] == 0 and no_prediction["f1"] == 0
    empty_class = binary_scores(a([0, 0]), a([0, 0]), a([1, 1]))
    assert empty_class["f1"] is None and empty_class["iou"] is None
    excluded = binary_scores(a([1, 1]), a([1, 0]), a([1, 0]))
    assert excluded["fp_px"] == 0 and excluded["f1"] == 1
    try:
        binary_scores(a([1]), a([1, 0]), a([1]))
    except ValueError:
        pass
    else:
        raise AssertionError("Mismatched grids were accepted")
    print("5 validation metric cases passed: mixed classes, no predictions, empty class, invalid pixels, mismatched grids")


if __name__ == "__main__":
    main()
