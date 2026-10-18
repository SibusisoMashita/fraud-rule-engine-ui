// Backend source commit: ef4a7e87b2740500b55274e1fe131e9e8f363912
export interface paths {
    "/api/v1/transactions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Evaluate one BOOKED outgoing debit
         * @description Requires ingest role; scope derived from credential. Stable eventId is the business debit identity. 5xx/transport failure may follow a commit: replay identical ID/payload. Existing replay bypasses current new-event age/currency eligibility, but not authorization or safety bounds.
         */
        post: operations["ingestTransaction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/transactions/{eventId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieve original scoped event and evaluation */
        get: operations["getTransaction"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/evaluations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a bounded live keyset page
         * @description Ascending (acceptedAt,id). Not a stable snapshot or complete reconciliation feed under concurrent commits. Date interval [acceptedFrom,acceptedTo); default range one day, configured maximum 31 days. Cursor binds scope, filters, page size and resolved date bounds; repeat explicit filters and page size unchanged. Default dates are resolved from the database clock on the first page. Invalid or changed cursors return 400. Unknown, empty and duplicate query parameters are rejected.
         */
        get: operations["listEvaluations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect non-secret active policy
         * @description One captured active policy hash and all typed rule settings, including disabled rules. Requires POLICY; no credentials, startup limits or source YAML are returned. Changes are visible without restarting. Unknown query parameters are rejected.
         */
        get: operations["getRules"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read the complete editable active policy
         * @description Optional feature, disabled by default. Requires explicit global POLICY_ADMIN permission; ordinary POLICY permission is read-only inspection. Returns one joined active revision, hash and complete document. Unknown query parameters are rejected.
         */
        get: operations["getEditablePolicy"];
        /**
         * Activate a policy only if its base revision is still current
         * @description Optional global POLICY_ADMIN operation. Revalidates the complete document and atomically compares the revision under the policy head lock. An unchanged hash preserves the revision. A stale revision returns 412 even after A-to-B-to-A policy changes. New evaluations see the activated policy without restart; stored results are unchanged. A transport failure or POLICY_OUTCOME_UNKNOWN 503 may follow activation: read the current policy before deciding what to do, without automatic retries.
         */
        put: operations["activatePolicy"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/policy/validate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Validate a complete policy without activating it
         * @description Optional global POLICY_ADMIN operation. Uses the same policy loader and rule verification as activation; does not create versions, activations or financial records. A successful validation does not reserve a revision. All administrator requests share one POLICY_ADMIN bucket per principal, using the existing policy quota settings.
         */
        post: operations["validatePolicy"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Minimal process health; no dependency checks. */
        get: operations["liveness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Operational network only; exposure restricted by deployment. DB, Redis, schema and expected active policy. No diagnostics in response. */
        get: operations["readiness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Identifier: string;
        /**
         * Format: date-time
         * @description Explicit offset, valid calendar time, microsecond precision and normalized UTC year 0001–9999; leap seconds are unsupported.
         */
        Timestamp: string;
        /** @description Decimal string. Domain validation additionally requires >0, configured currency scale and maximum; no exponent. */
        Money: string;
        PhysicalLocation: {
            latitude: number;
            longitude: number;
            accuracyKm: number;
            /** @enum {string} */
            source: "VERIFIED_ATM_TERMINAL" | "VERIFIED_CARD_PRESENT_TERMINAL";
            city?: string;
        };
        TransactionInput: {
            eventId: components["schemas"]["Identifier"];
            customerId: components["schemas"]["Identifier"];
            instrumentId: components["schemas"]["Identifier"];
            /** @enum {string} */
            transactionType: "CARD_PURCHASE" | "ATM_WITHDRAWAL";
            /** @enum {string} */
            status: "BOOKED";
            /** @enum {string} */
            channel: "CARD_PRESENT" | "ECOMMERCE" | "ATM";
            amount: components["schemas"]["Money"];
            currency: string;
            category: string;
            /** @description For a new event, replace the illustrative timestamp with the current event time within the active policy's allowed age. Identical retries reuse the original timestamp and payload. */
            occurredAt: components["schemas"]["Timestamp"];
            physicalLocation?: components["schemas"]["PhysicalLocation"];
        } & unknown;
        RuleResult: {
            /** @description Stable extensible rule identifier. The configured registry defines active IDs, not a closed API enum. */
            ruleId: string;
            algorithmVersion: string;
            /** @enum {string} */
            status: "MATCH" | "NO_MATCH" | "NOT_APPLICABLE" | "INSUFFICIENT_DATA" | "DISABLED";
            reasonCode: string;
            /** @description Bounded scalar rule facts. Fields are defined by rule ID, algorithm version and evidenceSchemaVersion (a fact in this map). No credentials, payloads or raw coordinate history. Internal typed evidence is tested per rule. */
            evidence: {
                [key: string]: string | number | boolean;
            };
        };
        Evaluation: {
            /** Format: uuid */
            id: string;
            eventId: components["schemas"]["Identifier"];
            /** @enum {string} */
            decision: "CLEAR" | "FLAGGED" | "INDETERMINATE";
            /** @enum {string} */
            coverage: "COMPLETE" | "PARTIAL";
            policyHash: string;
            buildId: string;
            acceptedAt: components["schemas"]["Timestamp"];
            evaluatedAt: components["schemas"]["Timestamp"];
            contextHighWatermark: number;
            ruleResults: components["schemas"]["RuleResult"][];
        };
        TransactionResource: {
            transaction: components["schemas"]["TransactionInput"];
            evaluation: components["schemas"]["Evaluation"];
        };
        EvaluationPage: {
            items: components["schemas"]["Evaluation"][];
            nextCursor?: string;
        };
        RulesView: {
            policyHash: string;
            rules: {
                /** @description Stable extensible rule identifier. The configured registry defines active IDs, not a closed API enum. */
                ruleId: string;
                algorithmVersion: string;
                enabled: boolean;
                /** @description Non-secret active rule policy; exact typed settings are defined by the rule configuration schema. */
                settings: Record<string, never>;
            }[];
        };
        PolicyValidation: {
            policyHash: string;
        };
        EditablePolicy: {
            /** Format: int64 */
            revision: number;
            policyHash: string;
            document: components["schemas"]["PolicyDocument"];
        };
        /** @description Complete business document, using configuration keys rather than rule IDs. Exactly the registered rule keys must be present; disable a rule explicitly. Currency-specific maps cover exactly the supported currencies, thresholds fit currency bounds, at least one rule remains enabled, and the travel candidate limit cannot exceed startup safety limits. Unknown fields and scalar coercion are rejected. Monetary settings are decimal strings. */
        PolicyDocument: {
            /** @constant */
            schemaVersion: 1;
            /** @constant */
            canonicalizationVersion: 1;
            supportedCurrencies: {
                [key: string]: {
                    scale: number;
                    maxAmount: components["schemas"]["Money"];
                };
            };
            ingest: {
                maxEventAgeSeconds: number;
                maxFutureSkewSeconds: number;
            };
            rules: {
                highAmount: components["schemas"]["HighAmountSettings"];
                transactionVelocity: components["schemas"]["VelocitySettings"];
                cumulativeSpend: components["schemas"]["CumulativeSpendSettings"];
                impossibleTravel: components["schemas"]["ImpossibleTravelSettings"];
                smallPaymentBurstThenLarge: components["schemas"]["SmallPaymentBurstSettings"];
            } & {
                [key: string]: Record<string, never>;
            };
        };
        CurrencyThresholds: {
            [key: string]: components["schemas"]["Money"];
        };
        HighAmountSettings: {
            enabled: boolean;
            thresholds: components["schemas"]["CurrencyThresholds"];
        };
        VelocitySettings: {
            enabled: boolean;
            windowSeconds: number;
            maxTransactions: number;
        };
        CumulativeSpendSettings: {
            enabled: boolean;
            windowSeconds: number;
            thresholds: components["schemas"]["CurrencyThresholds"];
        };
        ImpossibleTravelSettings: {
            enabled: boolean;
            maxComparisonAgeSeconds: number;
            maxCandidates: number;
            maxSpeedKmh: number;
            minDistanceKm: number;
            travelAllowanceKm: number;
            maxAccuracyKm: number;
            trustedSources: ("VERIFIED_ATM_TERMINAL" | "VERIFIED_CARD_PRESENT_TERMINAL")[];
            eligibleChannels: ("ATM" | "CARD_PRESENT")[];
        };
        SmallPaymentBurstSettings: {
            enabled: boolean;
            windowSeconds: number;
            minSmallPayments: number;
            smallPaymentMaximum: components["schemas"]["CurrencyThresholds"];
            largePaymentThreshold: components["schemas"]["CurrencyThresholds"];
        };
        Problem: {
            /** Format: uri-reference */
            type: string;
            title: string;
            status: number;
            detail?: string;
            /** Format: uri-reference */
            instance?: string;
            code: string;
            correlationId: string;
            retryable: boolean;
            /** @enum {string} */
            outcome: "NOT_ACCEPTED" | "UNKNOWN";
        };
        Health: {
            /** @enum {string} */
            status: "UP" | "DOWN";
        };
    };
    responses: {
        /** @description Current editable policy and revision; activation returns the policy it committed */
        PolicySnapshot: {
            headers: {
                ETag: components["headers"]["PolicyRevision"];
                "Cache-Control": components["headers"]["CacheControl"];
                "X-Correlation-ID": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["EditablePolicy"];
            };
        };
        /** @description POLICY_REVISION_CONFLICT; another activation changed the base revision. Preserve the draft, read the current policy and review before trying again. */
        Problem412: {
            headers: {
                "Cache-Control": components["headers"]["CacheControl"];
                "X-Correlation-ID": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description POLICY_PRECONDITION_REQUIRED; activation requires the strong revision ETag in If-Match. */
        Problem428: {
            headers: {
                "Cache-Control": components["headers"]["CacheControl"];
                "X-Correlation-ID": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Malformed request/cursor */
        Problem400: {
            headers: {
                "Cache-Control": components["headers"]["CacheControl"];
                "X-Correlation-ID": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Missing or invalid credentials */
        Problem401: {
            headers: {
                "Cache-Control": components["headers"]["CacheControl"];
                "X-Correlation-ID": components["headers"]["CorrelationId"];
                "WWW-Authenticate": components["headers"]["Authenticate"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Role or evidence-source denied */
        Problem403: {
            headers: {
                "Cache-Control": components["headers"]["CacheControl"];
                "X-Correlation-ID": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Event payload or instrument ownership conflict */
        Problem409: {
            headers: {
                "Cache-Control": components["headers"]["CacheControl"];
                "X-Correlation-ID": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Request too large */
        Problem413: {
            headers: {
                "Cache-Control": components["headers"]["CacheControl"];
                "X-Correlation-ID": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Unsupported request media type */
        Problem415: {
            headers: {
                "Cache-Control": components["headers"]["CacheControl"];
                "X-Correlation-ID": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description New event violates domain/policy, or POLICY_INVALID for an incompatible administrator policy candidate */
        Problem422: {
            headers: {
                "Cache-Control": components["headers"]["CacheControl"];
                "X-Correlation-ID": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Shared quota exhausted */
        Problem429: {
            headers: {
                "Cache-Control": components["headers"]["CacheControl"];
                "X-Correlation-ID": components["headers"]["CorrelationId"];
                "Retry-After": components["headers"]["RetryAfter"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Unexpected application fault */
        Problem500: {
            headers: {
                "Cache-Control": components["headers"]["CacheControl"];
                "X-Correlation-ID": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Dependency, admission or deadline failure; outcome can be unknown */
        Problem503: {
            headers: {
                "Cache-Control": components["headers"]["CacheControl"];
                "X-Correlation-ID": components["headers"]["CorrelationId"];
                "Retry-After": components["headers"]["RetryAfter"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Other application errors such as 405/406 use Problem; an upstream proxy may have its own error representation. */
        UnexpectedError: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Absent or inaccessible object */
        Problem404: {
            headers: {
                "Cache-Control": components["headers"]["CacheControl"];
                "X-Correlation-ID": components["headers"]["CorrelationId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
    };
    parameters: never;
    requestBodies: {
        PolicyDocument: {
            content: {
                "application/json": components["schemas"]["PolicyDocument"];
            };
        };
    };
    headers: {
        /** @description Strong active revision ETag for a conditional policy activation; changes even when a previous hash is activated again. */
        PolicyRevision: string;
        /** @description Sensitive business responses are not cacheable. */
        CacheControl: "no-store";
        /** @description Server-generated safe correlation identifier. */
        CorrelationId: string;
        Authenticate: "ApiKey";
        /** @description Seconds before retry; required on retryable 503 and 429. */
        RetryAfter: number;
    };
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    ingestTransaction: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "eventId": "evt-001",
                 *       "customerId": "customer-123",
                 *       "instrumentId": "card-token-456",
                 *       "transactionType": "CARD_PURCHASE",
                 *       "status": "BOOKED",
                 *       "channel": "ECOMMERCE",
                 *       "amount": "1500.00",
                 *       "currency": "ZAR",
                 *       "category": "GROCERIES",
                 *       "occurredAt": "2026-10-15T10:00:00Z"
                 *     }
                 */
                "application/json": components["schemas"]["TransactionInput"];
            };
        };
        responses: {
            /** @description Identical replay of original stored result */
            200: {
                headers: {
                    "Cache-Control": components["headers"]["CacheControl"];
                    "X-Correlation-ID": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransactionResource"];
                };
            };
            /** @description New committed evaluation */
            201: {
                headers: {
                    "Cache-Control": components["headers"]["CacheControl"];
                    "X-Correlation-ID": components["headers"]["CorrelationId"];
                    /** @description URI of scoped transaction resource. */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransactionResource"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            409: components["responses"]["Problem409"];
            413: components["responses"]["Problem413"];
            415: components["responses"]["Problem415"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            500: components["responses"]["Problem500"];
            503: components["responses"]["Problem503"];
            default: components["responses"]["UnexpectedError"];
        };
    };
    getTransaction: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: components["schemas"]["Identifier"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Original committed event/evaluation */
            200: {
                headers: {
                    "Cache-Control": components["headers"]["CacheControl"];
                    "X-Correlation-ID": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransactionResource"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            404: components["responses"]["Problem404"];
            429: components["responses"]["Problem429"];
            500: components["responses"]["Problem500"];
            503: components["responses"]["Problem503"];
            default: components["responses"]["UnexpectedError"];
        };
    };
    listEvaluations: {
        parameters: {
            query?: {
                customerId?: components["schemas"]["Identifier"];
                decision?: "CLEAR" | "FLAGGED" | "INDETERMINATE";
                acceptedFrom?: components["schemas"]["Timestamp"];
                acceptedTo?: components["schemas"]["Timestamp"];
                pageSize?: number;
                cursor?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Bounded page; nextCursor omitted on last page */
            200: {
                headers: {
                    "Cache-Control": components["headers"]["CacheControl"];
                    "X-Correlation-ID": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvaluationPage"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            500: components["responses"]["Problem500"];
            503: components["responses"]["Problem503"];
            default: components["responses"]["UnexpectedError"];
        };
    };
    getRules: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Active rule metadata/settings */
            200: {
                headers: {
                    "Cache-Control": components["headers"]["CacheControl"];
                    "X-Correlation-ID": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RulesView"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            429: components["responses"]["Problem429"];
            500: components["responses"]["Problem500"];
            503: components["responses"]["Problem503"];
            default: components["responses"]["UnexpectedError"];
        };
    };
    getEditablePolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["PolicySnapshot"];
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            429: components["responses"]["Problem429"];
            500: components["responses"]["Problem500"];
            503: components["responses"]["Problem503"];
            default: components["responses"]["UnexpectedError"];
        };
    };
    activatePolicy: {
        parameters: {
            query?: never;
            header: {
                /** @description One strong revision ETag obtained from GET, for example "policy-revision-1". Weak tags, lists and wildcard are unsupported. Missing header returns 428; malformed header returns 400. */
                "If-Match": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: components["requestBodies"]["PolicyDocument"];
        responses: {
            200: components["responses"]["PolicySnapshot"];
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            412: components["responses"]["Problem412"];
            413: components["responses"]["Problem413"];
            415: components["responses"]["Problem415"];
            422: components["responses"]["Problem422"];
            428: components["responses"]["Problem428"];
            429: components["responses"]["Problem429"];
            500: components["responses"]["Problem500"];
            503: components["responses"]["Problem503"];
            default: components["responses"]["UnexpectedError"];
        };
    };
    validatePolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: components["requestBodies"]["PolicyDocument"];
        responses: {
            /** @description Candidate is compatible with this service; no stored state was changed */
            200: {
                headers: {
                    "Cache-Control": components["headers"]["CacheControl"];
                    "X-Correlation-ID": components["headers"]["CorrelationId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PolicyValidation"];
                };
            };
            400: components["responses"]["Problem400"];
            401: components["responses"]["Problem401"];
            403: components["responses"]["Problem403"];
            413: components["responses"]["Problem413"];
            415: components["responses"]["Problem415"];
            422: components["responses"]["Problem422"];
            429: components["responses"]["Problem429"];
            500: components["responses"]["Problem500"];
            503: components["responses"]["Problem503"];
            default: components["responses"]["UnexpectedError"];
        };
    };
    liveness: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Process live */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
        };
    };
    readiness: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Ready */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
            /** @description Not ready */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
        };
    };
}
