/* Reviews are self-reported browser records, bound to one optical export and area. */
"use strict";
window.SBWaterReviews = (() => {
  const outcomes = {
    reviewed: "Reviewed",
    needs_data: "More evidence needed",
    disputed: "Interpretation disputed",
  };
  function keyFor(study, sectorId = null) {
    if (
      !/^[a-z][a-z0-9-]*$/.test(study?.id || "") ||
      !/^[a-f0-9]{64}$/.test(study.package_id || "") ||
      (sectorId !== null && !study.sectors.some((s) => s.id === sectorId))
    )
      throw new Error("Unknown optical study or area.");
    // Retain the keys used by the first optical release so existing reviews survive.
    return `sar-bridge:optical-review:${study.id}:${study.package_id}:${sectorId === null ? "whole" : sectorId}`;
  }
  function fields(value) {
    const reviewer =
      typeof value?.reviewer === "string" ? value.reviewer.trim() : "";
    const rationale =
      typeof value?.rationale === "string" ? value.rationale.trim() : "";
    if (reviewer.length < 2 || reviewer.length > 100)
      throw new Error("Enter a reviewer name between 2 and 100 characters.");
    if (!Object.hasOwn(outcomes, value.outcome))
      throw new Error("Select a review assessment.");
    if (rationale.length < 20 || rationale.length > 2000)
      throw new Error(
        "Describe the evidence and rationale in 20 to 2000 characters.",
      );
    return { reviewer, outcome: value.outcome, rationale };
  }
  function validateRecord(record, study, sectorId) {
    fields(record);
    if (
      record.study_id !== study.id ||
      record.package_id !== study.package_id ||
      record.sector_id !== sectorId ||
      record.source !== "local_self_reported" ||
      typeof record.created_utc !== "string" ||
      !/^\d{4}-\d\d-\d\dT/.test(record.created_utc) ||
      !Number.isFinite(Date.parse(record.created_utc))
    )
      throw new Error(
        "A stored review belongs to another area, version, or has an invalid timestamp.",
      );
  }
  function create({ storage, now = () => new Date().toISOString() }) {
    function read(study, sectorId = null) {
      const raw = storage.getItem(keyFor(study, sectorId));
      if (raw === null) return [];
      let records;
      try {
        records = JSON.parse(raw);
      } catch {
        throw new Error(
          "Stored review data is unreadable; it was not overwritten.",
        );
      }
      if (!Array.isArray(records))
        throw new Error(
          "Stored review data is unreadable; it was not overwritten.",
        );
      for (const record of records) validateRecord(record, study, sectorId);
      return records;
    }
    function save(study, sectorId, value) {
      const record = {
        ...fields(value),
        study_id: study.id,
        sector_id: sectorId,
        package_id: study.package_id,
        created_utc: now(),
        source: "local_self_reported",
      };
      validateRecord(record, study, sectorId);
      const previous = read(study, sectorId);
      storage.setItem(
        keyFor(study, sectorId),
        JSON.stringify([...previous, record]),
      );
      return record;
    }
    return { read, save };
  }
  function markdown(records) {
    return [
      "",
      "## Human review",
      "",
      "Self-reported reviews saved in this browser for the selected area and analysis package. Reviewer identities are not authenticated.",
      "",
      ...(records.length
        ? records.flatMap((r) => [
            `- Reviewer: ${r.reviewer}`,
            `  Assessment: ${outcomes[r.outcome]}`,
            `  Rationale: ${r.rationale}`,
            `  Time (UTC): ${r.created_utc}`,
            `  Study: ${r.study_id}; area: ${r.sector_id === null ? "whole study area" : `sector ${r.sector_id}`}`,
            `  Package: ${r.package_id}`,
            "",
          ])
        : ["No reviews recorded for this area and package.", ""]),
    ].join("\n");
  }
  return { create, keyFor, outcomes, markdown };
})();
