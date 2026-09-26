"""
VCF Compound Layer — Step 3b: canonicalise compound names against the
CAS/PubChem crosswalk, before Step 4 computes IDF over them.

Run from the repo root:  python pipeline/scripts/canonicalize_vcf_compounds.py

Reads:  pipeline/artifacts/vcf/step1_concat.parquet
        pipeline/vendor/vcf/vcfodor_cas_pubchem_distinct.xlsx
Writes: pipeline/artifacts/vcf/compounds.jsonl
        pipeline/artifacts/vcf/meta.json   (adds a "compounds" block)

Per the spec: exact-name match against the crosswalk first (it's keyed to
VCF's exact naming, "(=alias)" forms included), then strip a leading
stereochemistry descriptor and retry for the ~27% that miss that way.

One thing the spec doesn't mention, found while building this: the
crosswalk's own `Name` column has mojibake for ~5% of rows (287 of 5,879) —
Greek letters mangled during some encoding round-trip before we ever
touched it ("α" -> "?ｱ", "β" -> "?ｲ", confirmed against known compounds:
"ethylbenzene (=?ｱ-methyltoluene)" is really "...α-methyltoluene", "3-
methylpyridine (=?ｲ-picoline)" is really "...β-picoline"). Left uncorrected,
every legitimately-named α/β compound in VCF's clean text would silently
miss the crosswalk and get treated as a novel, "rare" compound — exactly
the failure mode the spec warns inflates IDF for no real reason. Fixed by
retrying with those two letters substituted to their known garbled form.

A garbled "??" token loses both encoded bytes rather than one, so it can't
be recovered from the crosswalk string alone. The crosswalk's own
"??-terpineol" appearing twice (CAS 586-81-2 and CAS 7299-42-5) is proof
it's genuinely ambiguous there, not just theoretically risky. Resolved for
this one pair by an external source rather than a guess: James identified
586-81-2 as γ-terpineol and 7299-42-5 as δ-terpineol, independently
confirmed against PubChem (CID 11467 = "Gamma-Terpineol", CID 81722 =
"Delta-Terpineol"). VCF's own compound field carries these as clean,
distinguishable Unicode text ("γ-terpineol", "δ-terpineol" — not the
crosswalk's garbled form), so COMPOUND_NAME_OVERRIDES below maps each
directly by exact clean name, bypassing the ambiguous crosswalk row
entirely. No other "??"-collapsed pair in the crosswalk has been resolved
this way — those stay unmatched.

Two more crosswalk Name collisions exist beyond that one (each with two
distinct CAS values under one string): "3-ethyl-1,2-cyclopentanedione" and
"neoisopulegol", both genuine stereoisomer pairs sharing a trivial name.
Resolved by taking the lower CAS number deterministically and flagging the
match as "exact_ambiguous_name" rather than silently picking one.
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
STEP1_PARQUET = REPO_ROOT / "pipeline" / "artifacts" / "vcf" / "step1_concat.parquet"
CROSSWALK_XLSX = REPO_ROOT / "pipeline" / "vendor" / "vcf" / "vcfodor_cas_pubchem_distinct.xlsx"
OUT_DIR = REPO_ROOT / "pipeline" / "artifacts" / "vcf"
COMPOUNDS_JSONL = OUT_DIR / "compounds.jsonl"
META_JSON = OUT_DIR / "meta.json"

# Leading stereochemistry descriptor — optical rotation sign, a bare or
# locant-qualified R/S or E/Z configuration ("(R)-", "(1R)-", "(2E,7Z)-"),
# or a bare cis-/trans- word. Applied repeatedly since some names chain two
# descriptors ("(1R)-(+)-camphene"). Retried only if it produces an actual
# crosswalk hit; a wrong strip just fails to match, it can't corrupt
# anything.
STEREO_PREFIX_RE = re.compile(
    r"^(?:\((?:\+/-|\+-|±|\+|-|\d{0,2}[RSEZ](?:,\d{0,2}[RSEZ])*|RS|SR|EZ|ZE)\)-|cis-|trans-)\s*",
    re.IGNORECASE,
)

# Confirmed by cross-checking known compounds against the crosswalk's own
# garbled spellings (see module docstring) — only the two letters whose
# mojibake is uniquely recoverable.
GREEK_TO_MOJIBAKE = {"α": "?ｱ", "β": "?ｲ"}

# Resolved 2026-08-28 (James, PubChem-confirmed) — see module docstring.
COMPOUND_NAME_OVERRIDES = {
    "γ-terpineol": {"cas": "586-81-2", "cid": 11467},
    "δ-terpineol": {"cas": "7299-42-5", "cid": 81722},
}

# Found 2026-08-28 while building Step 6b's descriptor join (which keys on
# pubchem_cid): the crosswalk's own PubChem-enrichment process has a
# fallback-to-a-previously-resolved-record bug. For CAS numbers where the
# real PubChem lookup evidently failed, the row got stamped with a COPY of
# an unrelated, already-resolved compound's full record (CID,
# MolecularFormula, CanonicalSmiles, IUPACName, etc.) instead of being left
# null — as if a failed lookup silently fell through to whatever record the
# batch process had last fetched successfully.
#
# Scope, precisely: I first found 8 "sentinel" CIDs where every VCF flavor
# compound sharing that CID was obviously unrelated to a small
# inorganic/simple molecule (HCl=313, H2SO4=1118, Ca2+=271, HNO3=944,
# HBr=260, acetic acid=176, ammonia=222, glycerol=753) — verified against
# MolecularFormula, with 3 rows per exception genuinely correct (CAS
# 64-19-7 acetic acid, 7664-41-7 ammonia, 56-81-5 glycerol; not nulled).
#
# I then tried to generalize this into an automatic classifier (comparing
# each row's own compound name against the crosswalk's IUPACName field for
# token overlap) to check the REST of the 5,879-row crosswalk, not just
# these 8 substances. That test surfaced two more unambiguous cases by the
# same signature — a single unrelated resolved record stamped across
# multiple flavor compounds with zero plausible connection:
#   CID 3559   (C21H23ClFNO2, a piperidine/haloperidol-like drug scaffold)
#              stamped onto 4 unrelated esters/pyrazines/fatty acids
#   CID 126941 (C20H22N8O5, methotrexate)
#              stamped onto 3 unrelated alcohols/esters/spiroketals
# Both added below alongside the original 8 sentinels; neither had a
# genuine member.
#
# The classifier does NOT generalize further than that. Run across the
# whole crosswalk it flags the majority of ALL rows (>50%) as "zero token
# overlap with IUPACName" — but manual spot-checking showed most of those
# are FALSE positives: PubChem's IUPACName is strict systematic
# nomenclature (e.g. "3,7-dimethyloct-6-enal") that routinely shares no
# words with a flavor compound's common name (e.g. "citronellal") even
# when the CID is completely correct. Distinguishing a real fallback-bug
# instance from a correct-but-differently-named compound at that scale
# needs either a real cheminformatics synonym resolver or live PubChem
# re-verification per CAS number (PubChem's PUG-REST API is blocked by
# this environment's network egress — confirmed by a direct connection
# test, HTTP CONNECT rejected). I did not build a full audit on a
# heuristic I'd already shown produces majority false positives; doing so
# would risk nulling out CIDs that are actually correct (real isomer/
# stereochemistry consolidations like the pentanol, farnesol, geraniol/
# nerol, and linalool-oxide groups I checked, all of which are genuinely
# one shared CID for real reasons and must NOT be touched).
#
# UPDATE 2026-08-28, same day: James asked to pursue live re-verification
# instead of stopping at the heuristic's limits. This environment's own
# egress still blocks pubchem.ncbi.nlm.nih.gov directly (curl and WebFetch
# both confirmed this — WebFetch additionally refuses the REST endpoint
# under robots.txt even where reachable), but the linked Mac's built-in
# browser pane can load pubchem.ncbi.nlm.nih.gov as a real page, and
# same-origin fetch() calls made from JS running on that page are not
# subject to the same restriction. Used that to run PubChem's own
# /xref/RegistryID/<CAS>/cids/JSON lookup live for every one of the 716
# actually-used CAS numbers that still shared a pubchem_cid with another
# actually-used CAS after the fix above (i.e. every residual collision,
# not the whole 5,879-row crosswalk).
#   240 confirmed: crosswalk's CID is exactly what PubChem returns live.
#   191 crosswalk's CID isn't what PubChem returns live, BUT the two CIDs
#       have the identical MolecularFormula (checked for all of them via
#       PubChem's batch /property endpoint) — this is PubChem's own
#       well-known duplicate/legacy-CID noise (the same real molecule
#       filed under two compound records), not the fallback bug. Left
#       untouched: nulling these would remove correct descriptor joins for
#       real isomer/stereochemistry families (confirms the pentanol,
#       butanediol, crotonaldehyde/crotonic-acid, acetoin, methylfuran,
#       methylthiophene, dihydropyran, and several other groups from the
#       original ambiguous residual really were fine as first suspected).
#   266 + 16 no live PubChem synonym record for that CAS at all, or a
#       persistent PUGREST.ServerBusy after multiple retries with
#       increasing backoff — inconclusive, not evidence of anything, left
#       untouched and reported as unverified rather than guessed at.
#   4 confirmed additional bugs by formula mismatch / internal
#       self-contradiction, added below:
#         CID 5360545 (IUPACName literally "sodium", formula Na) stamped
#         on CAS 28030-15-1 and CAS 4413-29-0 — a 9th sentinel of exactly
#         the same shape as the original 8, missed the first pass because
#         neither CAS collided with anything else in the auto-fixed set.
#         CID 4837 is genuinely piperazine (confirmed live for its other
#         member, CAS 110-85-0, correctly left alone) but was ALSO stamped
#         on CAS 21164-95-4, whose own crosswalk row names it "7,9-
#         dimethylhexadecane" — an C18 alkane cannot have formula C4H10N2;
#         self-contradictory regardless of live data.
#         CID 6278 is genuinely 1,1,1-trichloroethane (its sibling CAS
#         71-55-6 is extremely well-established chemistry) but was ALSO
#         stamped on CAS 25323-89-1, whose live PubChem CID (23424236,
#         C4H6Cl6) has a different formula entirely.
#   1 flagged and deliberately NOT fixed: CAS 491-04-3 ("piperitol") live-
#       resolves to CID 10247670 (C20H20O6, a lignan), formula-mismatched
#       against the crosswalk's CID 10282 (C10H18O). But 10282 is a
#       genuinely consistent 3-member group with CAS 16721-38-3/-39-4
#       ("cis-/trans-piperitol", same C10H18O monoterpene alcohol) — and
#       "piperitol" is a documented case of one trivial name shared by two
#       unrelated real compounds (the monoterpene and an unrelated
#       lignan). The crosswalk's assignment is the internally-consistent
#       one for this flavor-chemistry context; PubChem's own synonym index
#       is the more likely source of ambiguity here, not the crosswalk.
#       Left as-is rather than "corrected" into a worse answer.
#
# UPDATE 2026-08-29 (James's "check everything" audit): the classifier that
# found the original 12 groups was applied only to CID collisions among the
# 716 actually-used CAS numbers — it was never run against the crosswalk's
# other ~5,163 rows for the SAME "trivial-molecule CID shared with an
# implausible flavor-compound name" signature, even though nothing about
# that signature was scoped to collisions specifically. Doing that pass
# turned up 4 more groups, same evidence bar as the original 8 sentinels
# (MolecularFormula/IUPACName plainly a small inorganic/simple molecule,
# CAS row's own Name plainly an unrelated flavor compound, zero plausible
# chemical connection):
#   CID 1004  (H3O4P, phosphoric acid) on CAS 58319-04-3 (sesquisabinene),
#             58319-05-4 (cis-sesquisabinene hydrate), 80840-36-4
#             (isopropenyl-methylpyrazine) — no genuine member.
#   CID 962   (H2O, water/"oxidane") on CAS 146830-08-2 and 82427-00-7 —
#             no genuine member; no crosswalk row is actually named water.
#   CID 174   (C2H6O2, ethylene glycol) on CAS 107165-67-3
#             ("4-methylbenzoxazole") — the group's OTHER member, CAS
#             107-21-1, genuinely is glycol (Name literally says so) and
#             stays untouched, same pattern as acetic acid/ammonia/glycerol
#             in the original 8.
#   CID 971   (C2H2O4, oxalic acid) on CAS 70497-06-2 (a bicyclic ketone) —
#             the group's other member, CAS 144-62-7, genuinely is oxalic
#             acid and stays untouched.
# 5 of these 7 CAS are actually-used compound names in the current VCF
# snapshot (sesquisabinene, cis-sesquisabinene hydrate,
# isopropenyl-methylpyrazine, and the two CID-962 names); the
# ethylbenzoxazole/bicyclic-ketone pair currently isn't used but is added
# for correctness regardless, since the crosswalk row itself is wrong
# independent of whether this VCF pull happens to reference it.
#
# This still isn't a claim the crosswalk is now fully audited: the same
# scan, run to completion, flags a majority of all 5,879 rows by raw
# zero-token-overlap-with-IUPACName (see the classifier note above) and
# most of those are false positives for the same reason already explained
# (PubChem's systematic IUPACName routinely shares no words with a correct
# common flavor name). These 4 groups were only far enough into that list,
# sorted by "how small/simple is the misattached formula," to hand-verify
# quickly and confidently; the rest of that ranked list has not been
# reviewed. Treat KNOWN_BAD_PUBCHEM_CID_CAS as "everything checked so far
# and confirmed," not "everything wrong."
#
# Net effect: this fixes 16 confirmed-bad groups / 259 CAS numbers with
# hand-verified evidence (8 original sentinels + 2 zero-overlap classifier
# hits + 2 more surfaced by live re-verification + 4 more surfaced by
# extending the same classifier signature beyond just the 716 residual
# collisions), against 716 residual collisions actually checked live and a
# much larger unaudited remainder of the crosswalk (no collision, and not
# yet hand-checked on the zero-overlap ranking, -> no signal reviewed yet).
# compound_id (CAS-based) and Steps 4-6's IDF/pairing math are unaffected
# either way — only Step 6b's descriptor join reads pubchem_cid.
KNOWN_BAD_PUBCHEM_CID_CAS = {
    "101853-50-3", "103615-41-4", "104178-46-3", "10606-14-1", "106100-39-4", "107407-87-4",
    "108943-46-0", "110249-03-1", "11053-08-0", "11056-03-4", "11063-77-7", "11063-78-8",
    "11098-57-0", "113615-01-3", "115764-31-3", "117210-57-8", "121098-28-0", "121230-26-0",
    "1221-43-8", "123954-92-7", "124753-74-8", "124753-75-9", "125017-86-9", "126654-91-9",
    "126784-42-7", "129601-94-1", "13028-50-7", "13215-90-2", "133946-27-7", "134281-19-9",
    "135432-80-3", "137390-71-7", "137390-72-8", "15012-77-8", "15031-05-7", "153153-55-0",
    "156468-04-1", "15895-87-1", "179177-72-1", "18433-98-2", "18674-65-2", "20194-47-2",
    "20266-80-2", "20296-50-8", "20529-87-7", "20807-99-2", "20992-60-3", "20992-69-2",
    "21164-95-4", "21391-99-1", "21889-85-0", "21980-71-2", "23024-52-4", "23971-42-8", "24348-08-1",
    "24405-58-1", "24405-90-1", "24823-57-2", "24823-58-3", "25154-45-4", "25323-89-1", "25532-78-9",
    "26097-26-7", "26634-58-2", "26932-08-1", "27178-06-9", "27542-04-7", "27609-57-0",
    "27725-58-2", "27846-50-0", "27846-52-2", "27957-91-1", "28030-15-1", "28098-68-2", "28102-28-5",
    "288393-04-4", "28976-68-3", "29923-84-0", "29994-40-9", "30021-74-0", "30505-92-1",
    "30681-15-3", "3226-30-0", "32637-94-8", "32713-30-7", "33318-74-0", "33325-42-7",
    "33399-08-5", "33566-57-3", "33942-58-4", "34175-41-2", "34323-15-4", "35852-42-7",
    "35852-47-2", "35852-49-4", "35852-52-9", "36151-01-6", "36262-09-6", "36731-40-5",
    "36747-83-8", "38211-97-1", "38211-98-2", "38618-26-7", "38822-47-8", "38917-60-1",
    "38945-65-2", "39020-72-9", "39846-61-2", "39846-70-3", "4056-69-3", "40882-88-0",
    "40917-00-8", "41137-44-4", "41530-64-7", "41610-77-9", "41610-78-0", "41628-40-4",
    "41766-72-7", "41903-50-8", "41981-71-9", "42997-42-2", "4413-29-0", "4430-38-0", "45840-31-1",
    "50211-66-9", "50865-09-3", "50915-66-7", "51255-69-7", "51468-85-0", "51468-86-1",
    "52414-90-1", "52432-75-4", "52958-28-8", "53398-77-9", "53398-88-2", "53715-85-8",
    "53833-31-1", "53897-26-0", "53897-66-8", "54300-07-1", "54300-13-9", "54300-14-0",
    "54300-15-1", "54300-19-5", "55107-03-4", "55195-09-0", "55264-41-0", "55277-47-9",
    "55479-94-2", "55621-90-4", "55682-65-0", "55721-09-0", "55874-04-9", "56423-39-3",
    "56469-40-0", "56485-42-8", "56690-80-3", "56752-52-4", "56797-41-2", "56797-43-4",
    "57072-58-9", "57074-31-4", "57074-42-7", "57643-02-4", "57774-99-9", "57820-70-9",
    "57884-48-7", "57982-68-0", "58228-72-1", "5875-49-0", "5921-97-1", "59228-09-0",
    "59529-75-8", "59699-26-2", "60671-71-8", "60671-72-9", "60671-74-1", "60671-75-2",
    "60671-76-3", "60671-80-9", "6208-91-9", "621-58-9", "62238-00-0", "64079-00-1",
    "64608-60-2", "64608-61-3", "64613-69-0", "64828-52-0", "65128-97-4", "65128-99-6",
    "65293-09-6", "65437-21-0", "65901-84-0", "66573-83-9", "66573-85-1", "66607-94-1",
    "66719-06-0", "67421-83-4", "67700-26-9", "67883-00-5", "67999-48-8", "68113-53-1",
    "68547-66-0", "68862-25-9", "68914-28-3", "69024-85-7", "69064-37-5", "69078-76-8",
    "69078-84-8", "69078-85-9", "69671-15-4", "69891-94-7", "70622-31-0", "70664-96-9",
    "70713-26-7", "73285-58-2", "73809-82-2", "74416-64-1", "75567-02-1", "75935-84-1",
    "77311-04-7", "77311-05-8", "77311-08-1", "78053-99-3", "78054-00-9", "78054-01-0",
    "78054-02-1", "78054-03-2", "78054-04-3", "78054-05-4", "78054-06-5", "79926-00-4",
    "80311-19-9", "80581-06-2", "81624-01-3", "82000-05-3", "82561-68-0", "82678-01-1",
    "85236-72-2", "88395-46-4", "88395-49-7", "88395-50-0", "88552-98-1", "89145-04-0",
    "90243-46-2", "92177-52-1", "94794-09-9", "96693-89-9", "96693-91-3", "98962-89-1",
    "99742-03-7", "99881-85-3",
    # 4 groups added 2026-08-29 — see UPDATE note above.
    "58319-04-3", "58319-05-4", "80840-36-4", "146830-08-2", "82427-00-7",
    "107165-67-3", "70497-06-2",
}

# A few VCF compound strings embed their own CAS number directly, e.g.
# "yuzuol (CAS registry number: 1050211-66-9)" — free, zero-risk signal,
# used ahead of crosswalk lookup since it's VCF's own stated identity.
EMBEDDED_CAS_RE = re.compile(r"CAS registry number:\s*([\d\-]+)", re.IGNORECASE)


def strip_stereo_prefix(name: str) -> str:
    prev = None
    s = name
    while prev != s:
        prev = s
        s = STEREO_PREFIX_RE.sub("", s).strip()
    return s


def load_crosswalk() -> dict[str, dict]:
    xw = pd.read_excel(CROSSWALK_XLSX)
    by_name: dict[str, list[dict]] = defaultdict(list)
    for row in xw.itertuples(index=False):
        cid = None if pd.isna(row.CID) else int(row.CID)
        by_name[row.Name].append({"cas": row.CAS, "cid": cid})

    lookup: dict[str, dict] = {}
    for name, candidates in by_name.items():
        if len(candidates) == 1:
            lookup[name] = {**candidates[0], "ambiguous": False}
        else:
            # deterministic tie-break: lower CAS number wins, flagged.
            best = sorted(candidates, key=lambda c: [int(x) for x in c["cas"].split("-")])[0]
            lookup[name] = {**best, "ambiguous": True, "n_candidates": len(candidates)}
    return lookup


def try_match(name: str, lookup: dict[str, dict], cas_to_cid: dict[str, int]):
    """Return (hit_dict_or_None, method)."""
    if name in COMPOUND_NAME_OVERRIDES:
        hit = COMPOUND_NAME_OVERRIDES[name]
        return {**hit, "ambiguous": False}, "name_override"

    cas_embedded = EMBEDDED_CAS_RE.search(name)
    if cas_embedded:
        cas = cas_embedded.group(1)
        return {"cas": cas, "cid": cas_to_cid.get(cas), "ambiguous": False}, "embedded_cas"

    if name in lookup:
        hit = lookup[name]
        return hit, ("exact_ambiguous_name" if hit["ambiguous"] else "exact")

    stripped = strip_stereo_prefix(name)
    if stripped != name and stripped in lookup:
        hit = lookup[stripped]
        return hit, ("stereo_stripped_ambiguous_name" if hit["ambiguous"] else "stereo_stripped")

    for candidate, tag in ((name, "greek_normalized"), (stripped, "stereo_stripped+greek_normalized")):
        if any(g in candidate for g in GREEK_TO_MOJIBAKE):
            garbled = candidate
            for greek, moji in GREEK_TO_MOJIBAKE.items():
                garbled = garbled.replace(greek, moji)
            if garbled in lookup:
                hit = lookup[garbled]
                return hit, (tag + "_ambiguous_name" if hit["ambiguous"] else tag)

    return None, "unmatched"


def slugify(name: str) -> str:
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


def main():
    if not STEP1_PARQUET.exists():
        raise SystemExit(f"{STEP1_PARQUET} not found — run parse_vcf_products.py first.")
    if not CROSSWALK_XLSX.exists():
        raise SystemExit(f"{CROSSWALK_XLSX} not found.")

    df = pd.read_parquet(STEP1_PARQUET)
    lookup = load_crosswalk()
    cas_to_cid = {v["cas"]: v["cid"] for v in lookup.values()}

    group_by_compound: dict[str, str] = {}
    for compound, sub in df.groupby("Compound")["Compound Group"]:
        group_by_compound[compound] = Counter(sub).most_common(1)[0][0]

    rows = []
    method_counts: Counter = Counter()
    n_bad_cid_nulled = 0
    for compound in sorted(df["Compound"].unique()):
        hit, method = try_match(compound, lookup, cas_to_cid)
        method_counts[method] += 1
        if hit is not None:
            compound_id = hit["cas"]
            cas, cid = hit["cas"], hit["cid"]
            if cas in KNOWN_BAD_PUBCHEM_CID_CAS:
                # See KNOWN_BAD_PUBCHEM_CID_CAS docstring above: this CAS's
                # crosswalk row is a confirmed misattached-record bug.
                # compound_id stays CAS-based (unaffected); only the
                # PubChem CID — and anything joined on it, i.e. Step 6b's
                # descriptor table — is corrected by nulling it here.
                cid = None
                n_bad_cid_nulled += 1
        else:
            compound_id = f"vcf:{slugify(compound)}"
            cas, cid = None, None
        rows.append(
            {
                "raw_compound": compound,
                "compound_group": group_by_compound.get(compound),
                "compound_id": compound_id,
                "cas": cas,
                "pubchem_cid": cid,
                "match_method": method,
            }
        )

    with open(COMPOUNDS_JSONL, "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    n_raw = len(rows)
    n_matched = sum(v for k, v in method_counts.items() if k != "unmatched")
    n_canonical = len({r["compound_id"] for r in rows})
    n_ambiguous = sum(v for k, v in method_counts.items() if "ambiguous" in k)

    meta = json.loads(META_JSON.read_text()) if META_JSON.exists() else {}
    meta["compounds"] = {
        "n_raw_compound_strings": n_raw,
        "n_matched": n_matched,
        "match_rate": round(n_matched / n_raw, 4),
        "match_method_counts": dict(method_counts),
        "n_ambiguous_crosswalk_matches": n_ambiguous,
        "n_distinct_compound_ids_after_canonicalization": n_canonical,
        "dedup_delta": n_raw - n_canonical,
        "crosswalk_rows": len(pd.read_excel(CROSSWALK_XLSX, usecols=["Name"])),
        "n_known_bad_pubchem_cid_nulled": n_bad_cid_nulled,
        "known_bad_pubchem_cid_note": (
            "16 confirmed-bad crosswalk groups (259 CAS numbers) had their "
            "pubchem_cid nulled, including 2 found via a live PubChem "
            "re-verification pass over 716 residual collisions and 4 more "
            "found by extending that same classifier signature beyond just "
            "those collisions (2026-08-29 audit) — see "
            "KNOWN_BAD_PUBCHEM_CID_CAS in this script for the full "
            "investigation and its explicit scope limits, including that "
            "the crosswalk's much larger unaudited remainder has not been "
            "hand-checked. compound_id (CAS-based) is unaffected."
        ),
    }
    META_JSON.write_text(json.dumps(meta, indent=2))

    print(f"Wrote {n_raw} compound rows to {COMPOUNDS_JSONL}")
    print(f"Match methods: {dict(method_counts)}")
    print(f"Overall match rate: {n_matched}/{n_raw} = {n_matched/n_raw:.1%}")
    print(f"Distinct compound_ids after canonicalization: {n_canonical} (raw strings: {n_raw}, "
          f"dropped {n_raw - n_canonical})")
    print(f"Ambiguous crosswalk name collisions used: {n_ambiguous}")
    print(f"Known-bad crosswalk pubchem_cid nulled: {n_bad_cid_nulled} CAS numbers (16 confirmed-bad groups)")


if __name__ == "__main__":
    main()
