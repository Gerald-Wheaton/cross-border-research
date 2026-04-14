# Database Reference

## Overview

This project uses a Neon-hosted PostgreSQL database named `neondb`.

The schema is small and centered on a rules knowledge base for U.S., India, and cross-border tax/regulatory logic. The main data model is:

`jurisdiction` -> `rule` <- `verification_status`

and

`rule` <-> `rule` through `rule_interaction`

plus a lookup table for rule categories:

`category` <- `rule`

## Tables

### `jurisdiction`

Reference table for the legal/tax domain a rule belongs to.

Columns:
- `jurisdiction_id` `varchar` primary key
- `name` `varchar`
- `code` `varchar` unique

Current known values:
- `US`
- `IND`
- `CROSS`

### `verification_status`

Lookup table describing review maturity for a rule.

Columns:
- `status_code` `varchar` primary key
- `label` `varchar`
- `description` `text`
- `sort_order` `smallint` unique

Known values currently include:
- `NEEDS_RESEARCH`
- `NEEDS_PROFESSIONAL_REVIEW`
- `REVIEWED`
- `VERIFIED`
- `AI_REVIEWED`

### `category`

Lookup table for rule categories. `label` is the human-facing text; `category_code` is the stable machine slug.

Columns:
- `category_code` `varchar` primary key
- `label` `varchar`
- `description` `text` nullable
- `sort_order` `smallint` unique

Examples:
- `capital-controls-remittance` -> `Capital Controls / Remittance`
- `tax-withholding` -> `Tax / Withholding`
- `compliance-regulatory-risk` -> `Compliance / Regulatory Risk`

### `rule`

Primary knowledge object representing a tax, compliance, remittance, or interaction rule.

Columns:
- `rule_id` `varchar` primary key
- `name` `varchar`
- `jurisdiction_id` `varchar` references `jurisdiction.jurisdiction_id`
- `section` `varchar`
- `category` `varchar` references `category.category_code`
- `trigger_condition` `text`
- `calculation_outcome` `text`
- `legal_source` `text`
- `edge_cases` `text`
- `notes_for_platform` `text`
- `last_verified` `date`
- `verification_status` `varchar` references `verification_status.status_code`
- `logic_category` `varchar`

Allowed `logic_category` values:
- `CALC`
- `TREE`
- `INTERACTION`

### `rule_interaction`

Join/graph table that expresses how one rule affects another.

Columns:
- `interaction_id` `integer` primary key
- `from_rule_id` `varchar` references `rule.rule_id`
- `to_rule_id` `varchar` references `rule.rule_id`
- `interaction_type` `varchar`
- `description` `text`

Allowed `interaction_type` values:
- `GATES`
- `LIMITS`
- `TRIGGERS`
- `BLOCKS`
- `MODIFIES`

## Relationship Summary

- Every `rule` belongs to one `jurisdiction`.
- Every `rule` has one `verification_status`.
- Every `rule` has one `category`.
- `rule_interaction` creates a directed graph between rules.

## Current Practical Guidance

- Treat `category.label` as display text and `category.category_code` as a stable key.
- Treat `verification_status.status_code` as the stable key and `label` as display text.
- If a future migration changes lookup values, update dependent foreign-key columns in the same transaction.
