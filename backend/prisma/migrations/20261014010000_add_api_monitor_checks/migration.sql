CREATE TYPE "MonitorStatus" AS ENUM ('UP', 'DEGRADED', 'DOWN', 'RESTRICTED', 'TIMEOUT');

CREATE TABLE "ApiMonitorCheck" (
    "id" UUID NOT NULL,
    "monitorKey" VARCHAR(64) NOT NULL,
    "status" "MonitorStatus" NOT NULL,
    "httpStatus" INTEGER,
    "responseTimeMs" INTEGER NOT NULL,
    "checkedAt" TIMESTAMPTZ(3) NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    CONSTRAINT "ApiMonitorCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApiMonitorCheck_monitorKey_checkedAt_id_idx"
ON "ApiMonitorCheck"("monitorKey", "checkedAt" DESC, "id" DESC);
