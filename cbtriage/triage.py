"""cbtriage triage: the named custom fields Zendesk keeps on every ticket (Component, Case Type, versions, impact, ...),
read from the ticket document. trr-studio curates the same fields (Product Type, Entitlement, Couchbase Server, Case Type, Component)."""
ORDER = ["Component", "Case Type", "Couchbase Server", "Couchbase Autonomous Operator", "Environment / Current Impact", "Node Count", "Product Type",
         "Entitlement", "Region", "Highest Ever Priority", "Escalation Level", "CBSE", "ESC / ENT", "Bug ID", "Root Cause", "Resolution", "Resolution tier",
         "SDK Related", "Logs Check", "Product Area", "Business Impact", "Cluster ID", "Requires Handover", "Mitigated (do not set directly)", "RCAed (do not set directly)"]
LABEL = {"Environment / Current Impact": "Impact", "Couchbase Server": "Server version", "Couchbase Autonomous Operator": "Operator version",
         "Mitigated (do not set directly)": "Mitigated", "RCAed (do not set directly)": "Root cause analysed", "ESC / ENT": "ESC / ENT"}


def _val(v):
    if v in (None, "", [], {}):
        return ""
    if isinstance(v, (list, tuple)):
        return ", ".join(x for x in (_val(i) for i in v) if x)
    s = str(v).strip()
    if s in ("False", "false"):
        return ""
    if s in ("True", "true"):
        return "Yes"
    return s.replace("::", " > ")


def parse(fields):
    """[{name, label, value}] for the fields that have a value, in a useful order."""
    f = fields or {}
    out = []
    for n in ORDER:
        v = _val(f.get(n))
        if v:
            out.append({"name": n, "label": LABEL.get(n, n), "value": v})
    return out


def summary(fields):
    f = fields or {}
    g = lambda n: _val(f.get(n))  # noqa: E731
    return {"component": g("Component"), "case_type": g("Case Type"), "version": g("Couchbase Server"), "operator": g("Couchbase Autonomous Operator"),
            "impact": g("Environment / Current Impact"), "nodes": g("Node Count")}
