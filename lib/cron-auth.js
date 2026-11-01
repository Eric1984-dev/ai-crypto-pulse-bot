"use strict";

const { timingSafeEqual } = require("node:crypto");

function isAuthorizedCron(authorization, secret) {
  if (typeof authorization !== "string" || typeof secret !== "string" || !secret) {
    return false;
  }
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(secret);
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
}

module.exports = { isAuthorizedCron };
