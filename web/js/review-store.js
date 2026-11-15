/* Local, self-reported review history. Never an authenticated scientific sign-off. */
"use strict";
window.SBReviewStore = (() => {
  const KEY = "sar-bridge-review-log-v1";
  const outcomes = {
    reviewed: "Review completed",
    needs_data: "More evidence needed",
    disputed: "Interpretation disputed",
  };
  const actions = {
    water_level: "Request water-level records",
    optical: "Request independent imagery",
    field_review: "Refer for field review",
    document: "Document observation",
  };
  const keyFor = (unit) =>
    unit.id === undefined || unit.id === null
      ? "reservoir"
      : `sector-${unit.id}`;
  function create({
    storage,
    data,
    now = () => new Date().toISOString(),
    uuid = () => crypto.randomUUID(),
  }) {
    const version = data.validation.package_id;
    const units = new Map(
      [data.analysis.study_area, ...data.analysis.sectors].map((unit) => [
        keyFor(unit),
        unit,
      ]),
    );
    let records = [];
    const snapshot = (unit) => ({
      loss_ha: unit.detected_change.loss_ha,
      gain_ha: unit.detected_change.gain_ha,
      dates: [...unit.detected_change.dates],
      engine_status: unit.conclusion.status,
      engine_label: unit.conclusion.label,
    });
    function validate(record) {
      const validText = (value, min, max) =>
        typeof value === "string" &&
        value.trim().length >= min &&
        value.length <= max;
      if (
        !record ||
        !validText(record.id, 1, 100) ||
        !units.has(record.unit_key) ||
        !/^[a-f0-9]{64}$/.test(record.package_id || "") ||
        !validText(record.reviewer, 2, 100) ||
        !validText(record.rationale, 20, 2000) ||
        !Object.hasOwn(outcomes, record.outcome) ||
        !Object.hasOwn(actions, record.next_action) ||
        typeof record.evidence_reference !== "string" ||
        record.evidence_reference.length > 500 ||
        typeof record.created_utc !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
          record.created_utc,
        ) ||
        !Number.isFinite(Date.parse(record.created_utc)) ||
        record.source !== "self_reported_local_review"
      )
        throw new Error("Review record is incomplete or invalid.");
      if (
        /^[a-z][a-z0-9+.-]*:/i.test(record.evidence_reference) &&
        !/^https?:\/\//i.test(record.evidence_reference)
      )
        throw new Error(
          "Evidence links must use HTTPS or HTTP; document IDs are also accepted.",
        );
      const observed = record.observation;
      if (
        !observed ||
        !["loss_ha", "gain_ha"].every(
          (k) => Number.isFinite(observed[k]) && observed[k] >= 0,
        ) ||
        !Array.isArray(observed.dates) ||
        observed.dates.length !== 2 ||
        !observed.dates.every(
          (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d),
        ) ||
        !validText(observed.engine_status, 1, 100) ||
        !validText(observed.engine_label, 1, 150)
      )
        throw new Error("Review measurement snapshot is missing.");
      const normalizedObservation = {
        loss_ha: observed.loss_ha,
        gain_ha: observed.gain_ha,
        dates: observed.dates,
        engine_status: observed.engine_status,
        engine_label: observed.engine_label,
      };
      if (
        record.package_id === version &&
        JSON.stringify(normalizedObservation) !==
          JSON.stringify(snapshot(units.get(record.unit_key)))
      )
        throw new Error(
          "Review observation does not match this analysis version.",
        );
      return {
        id: record.id,
        package_id: record.package_id,
        unit_key: record.unit_key,
        reviewer: record.reviewer,
        outcome: record.outcome,
        rationale: record.rationale,
        evidence_reference: record.evidence_reference,
        next_action: record.next_action,
        created_utc: record.created_utc,
        observation: normalizedObservation,
        source: record.source,
      };
    }
    function parse(text) {
      if (text.length > 2_000_000) throw new Error("Review log is too large.");
      let log;
      try {
        log = JSON.parse(text);
      } catch {
        throw new Error(
          "Review log is not valid JSON. Existing records were kept.",
        );
      }
      if (
        log.schema_version !== 1 ||
        !Array.isArray(log.records) ||
        log.records.length > 1000
      )
        throw new Error("Unsupported review-log format.");
      const parsed = log.records.map(validate);
      if (new Set(parsed.map((record) => record.id)).size !== parsed.length)
        throw new Error(
          "Duplicate review record IDs. Existing history was kept.",
        );
      return parsed;
    }
    const existing = storage.getItem(KEY);
    if (existing) records = parse(existing);
    function persist(next) {
      if (next.length > 1000)
        throw new Error(
          "Local review log is full. Export your records before continuing.",
        );
      const serialized = JSON.stringify({ schema_version: 1, records: next });
      if (serialized.length > 2_000_000)
        throw new Error(
          "Local review log is full. Export your records before continuing.",
        );
      storage.setItem(KEY, serialized);
      records = next;
    }
    const all = () =>
      records
        .map((record) => JSON.parse(JSON.stringify(record)))
        .sort(
          (a, b) =>
            a.created_utc.localeCompare(b.created_utc) ||
            a.id.localeCompare(b.id),
        );
    const current = (key) =>
      all().filter(
        (record) => record.package_id === version && record.unit_key === key,
      );
    return {
      version,
      keyFor,
      all,
      current,
      latest: (key) => current(key).at(-1) || null,
      save(fields) {
        const unit = units.get(fields.unit_key);
        if (!unit) throw new Error("Choose a valid analysis area.");
        const record = validate({
          id: uuid(),
          package_id: version,
          unit_key: fields.unit_key,
          reviewer: fields.reviewer.trim(),
          outcome: fields.outcome,
          rationale: fields.rationale.trim(),
          evidence_reference: fields.evidence_reference.trim(),
          next_action: fields.next_action,
          created_utc: now(),
          observation: snapshot(unit),
          source: "self_reported_local_review",
        });
        persist([...records, record]);
        return JSON.parse(JSON.stringify(record));
      },
      export() {
        return JSON.stringify(
          {
            schema_version: 1,
            storage_scope: "local_browser_demo",
            identity_verified: false,
            package_id: version,
            exported_utc: now(),
            records: all(),
          },
          null,
          2,
        );
      },
      import(text) {
        const incoming = parse(text),
          merged = new Map(records.map((record) => [record.id, record]));
        let added = 0;
        for (const record of incoming) {
          if (merged.has(record.id)) {
            if (
              JSON.stringify(merged.get(record.id)) !== JSON.stringify(record)
            )
              throw new Error(
                "Conflicting record IDs. Existing history was kept.",
              );
          } else {
            merged.set(record.id, record);
            added++;
          }
        }
        persist([...merged.values()]);
        return added;
      },
    };
  }
  return { create, outcomes, actions, keyFor };
})();
