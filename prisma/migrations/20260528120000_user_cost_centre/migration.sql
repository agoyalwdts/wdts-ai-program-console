-- ADR 0002: FinOps showback key on User (nullable until mapped).
ALTER TABLE "User" ADD COLUMN "costCentre" TEXT;

CREATE INDEX "User_costCentre_idx" ON "User"("costCentre");
