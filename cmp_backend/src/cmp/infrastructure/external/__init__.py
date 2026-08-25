"""Outbound HTTP clients. Timeouts are set here so no call site can forget one."""

from cmp.infrastructure.external.clients import build_client, request_json

__all__ = ["build_client", "request_json"]
