-- Reusable icons for Service, PropertyType, Package — both nullable, fully backward
-- compatible with existing rows (iconUrl takes precedence over iconName when both are set).
ALTER TABLE "Service" ADD COLUMN "iconName" TEXT, ADD COLUMN "iconUrl" TEXT;
ALTER TABLE "PropertyType" ADD COLUMN "iconName" TEXT, ADD COLUMN "iconUrl" TEXT;
ALTER TABLE "Package" ADD COLUMN "iconName" TEXT, ADD COLUMN "iconUrl" TEXT;
