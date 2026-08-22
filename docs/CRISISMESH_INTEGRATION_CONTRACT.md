# CrisisMesh AI Integration Contract

## 1. Purpose
This document specifies the server-to-server integration contract from the perspective of **TEAM ALPHA (Disaster Alert System)**, enabling secure forwarding of emergency warning alerts to **CrisisMesh AI (Emergency Rescue/Decision Intelligence System)**.

---

## 2. Architecture
The integration relies on a decoupled, asynchronous, server-to-server HTTP API synchronization design. No database merging or sharing is required.

```
+------------------------------------+              +------------------------------------+
|             TEAM ALPHA             |              |           CRISISMESH AI            |
|       Realtime Database (RTDB)     |              |          Cloud Firestore           |
|       - Public Alerts Dashboard    |              |          - Optimization Solver     |
|       - Email Broadcast Service    |              |          - Command Center Portal   |
+------------------------------------+              +------------------------------------+
                  │                                                    ▲
                  │             HTTP Sync (Secure Webhook)             │
                  └────────────────────────────────────────────────────┘
```

---

## 3. Authentication & Security
* All service-to-service HTTP requests must use Bearer Token authorization:
  `Authorization: Bearer <CRISIS_INTEGRATION_KEY>`
* The token `CRISIS_INTEGRATION_KEY` must be stored securely in the hosting environment variables and **NEVER** exposed to client-side code, browser JavaScript, templates, or logs.

---

## 4. Environment Variables
The following environment variables must be populated on the TEAM ALPHA server environment:

```bash
# Enable or disable the synchronization pipeline
ENABLE_CRISIS_INTEGRATION=true

# The secure base URL of the CrisisMesh AI backend API
CRISISMESH_API_URL=https://crisismesh-backend-url.com

# Shared integration Bearer token
CRISIS_INTEGRATION_KEY=secure-random-token-stored-outside-source-code
```

---

## 5. Headers
All requests sent by TEAM ALPHA to CrisisMesh AI must include:
* `Content-Type: application/json`
* `Authorization: Bearer <CRISIS_INTEGRATION_KEY>`
* `X-Request-ID`: A unique UUID generated per HTTP request for auditability.
* `X-Correlation-ID`: The crisis-specific tracking ID (stable across re-runs or updates).

---

## 6. Canonical Crisis Payload
The synchronized payload sent to CrisisMesh (`POST /api/v1/incidents/sync`) uses the following schema:

```json
{
  "crisisId": "alt-1723300000000",
  "type": "FLOOD",
  "severity": "CRITICAL",
  "location": {
    "latitude": 13.0827,
    "longitude": 80.2707,
    "address": "Chennai, Tamil Nadu, India"
  },
  "description": "Extreme flooding reported near coastal bypass. Evacuations active.",
  "source": "TEAM_ALPHA_ADMIN",
  "createdAt": "2026-08-10T14:30:00.000Z",
  "updatedAt": "2026-08-10T14:31:00.000Z",
  "expiresAt": "2026-08-11T14:30:00.000Z",
  "environment": "REAL"
}
```

---

## 7. Field Mappings
The mapping from TEAM ALPHA Realtime Database alerts to CrisisMesh incidents is defined as follows:

| TEAM ALPHA RTDB Field | Canonical / CrisisMesh Field | Transformation Logic |
| :--- | :--- | :--- |
| Alert Key (`id`) | `crisisId` | Stored as the primary identifier. |
| `type` | `type` | Uppercased (e.g., `Flood` -> `FLOOD`). |
| `level` or `severity` | `severity` | Uppercased (e.g., `Critical` -> `CRITICAL`). |
| `lat` | `location.latitude` | Numeric match. |
| `lng` | `location.longitude` | Numeric match. |
| `location` | `location.address` | Geocoded street address name. |
| `description` or `desc` | `description` | String description text. |
| `createdBy` or `source` | `source` | Set to `TEAM_ALPHA_ADMIN` or `USGS_FEED`. |
| `createdAt` | `createdAt` | Convert Unix ms to ISO 8601 string. |
| `expiresAt` | `expiresAt` | Convert Unix ms to ISO 8601 string. |
| *(None)* | `environment` | **Statically set to 'REAL'**. |

---

## 8. REAL / SIMULATION Boundary Safety
> [!IMPORTANT]
> - All alerts synchronized from TEAM ALPHA must have `environment: "REAL"`.
> - CrisisMesh AI must reject any incoming sync request where `environment` is `SIMULATION` to prevent simulation data contamination.
> - CrisisMesh simulation ticks or digital twin incidents must never propagate back to TEAM ALPHA's public alert lists.

---

## 9. Idempotency & Duplicate Handling
* TEAM ALPHA uses the same `crisisId` for updates to an existing alert.
* CrisisMesh must check the `incidents` repository:
  * If `crisisId` does not exist: Create incident and trigger orchestration pipeline.
  * If `crisisId` exists: Update incident attributes, log a modification audit trail, and avoid triggering duplicate dispatch loops.

---

## 10. Error Handling
The following status codes are expected from CrisisMesh:
* `201 Created`: Incident successfully ingested and pipeline initialized.
* `200 OK`: Incident successfully updated or duplicate ignored safely.
* `400 Bad Request`: Validation failure (missing coordinates, invalid hazard type/severity).
* `401 Unauthorized`: Missing or invalid Bearer token.
* `403 Forbidden`: Attempted to send `environment: SIMULATION` to real-world intake.
* `503 Service Unavailable`: Firestore database down (CrisisMesh runs in fallback).
* `500 Internal Server Error`: Server failure.

TEAM ALPHA will log failures and enqueue unsynced alerts for automatic retries when CrisisMesh is unavailable.
