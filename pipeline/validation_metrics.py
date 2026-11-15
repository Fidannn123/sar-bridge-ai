"""Binary comparison metrics. The caller defines the reference and common-valid domain."""
import numpy as np


def binary_scores(prediction, reference, valid):
    prediction, reference, valid = [np.asarray(a, dtype=bool) for a in (prediction, reference, valid)]
    if prediction.shape != reference.shape or prediction.shape != valid.shape:
        raise ValueError("Prediction, reference and validity masks must share one grid")
    tp = int((valid & prediction & reference).sum())
    fp = int((valid & prediction & ~reference).sum())
    fn = int((valid & ~prediction & reference).sum())
    tn = int((valid & ~prediction & ~reference).sum())
    ratio = lambda numerator, denominator: round(numerator / denominator, 6) if denominator else None
    return {"tp_px": tp, "fp_px": fp, "fn_px": fn, "tn_px": tn,
            "predicted_positive_px": tp + fp, "reference_positive_px": tp + fn,
            "precision": ratio(tp, tp + fp), "recall": ratio(tp, tp + fn),
            "f1": ratio(2 * tp, 2 * tp + fp + fn), "iou": ratio(tp, tp + fp + fn)}
