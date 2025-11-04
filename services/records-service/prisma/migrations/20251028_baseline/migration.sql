-- DropForeignKey
ALTER TABLE "records"."record_media" DROP CONSTRAINT "record_media_record_id_fkey";

-- AlterTable
ALTER TABLE "records"."records" ADD COLUMN     "artist_norm" TEXT,
ADD COLUMN     "name_norm" TEXT,
ADD COLUMN     "search_norm" TEXT,
ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
ALTER COLUMN "purchased_at" SET DATA TYPE TIMESTAMPTZ(6),
ALTER COLUMN "release_date" SET DATA TYPE TIMESTAMPTZ(6),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6),
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "records"."record_media" ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6),
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6);

-- AlterTable
-- AlterTable
ALTER TABLE "records"."records_staging" ADD COLUMN     "artist" VARCHAR(256) NOT NULL,
ADD COLUMN     "artist_norm" TEXT,
ADD COLUMN     "catalog_number" VARCHAR(64),
ADD COLUMN     "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "format" VARCHAR(64) NOT NULL,
ADD COLUMN     "has_booklet" BOOLEAN DEFAULT false,
ADD COLUMN     "has_factory_sleeve" BOOLEAN DEFAULT false,
ADD COLUMN     "has_insert" BOOLEAN DEFAULT false,
ADD COLUMN     "has_obi_strip" BOOLEAN DEFAULT false,
ADD COLUMN     "is_promo" BOOLEAN DEFAULT false,
ADD COLUMN     "name" VARCHAR(256) NOT NULL,
ADD COLUMN     "name_norm" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "price_paid" DECIMAL(10,2),
ADD COLUMN     "purchased_at" DATE,
ADD COLUMN     "record_grade" VARCHAR(16),
ADD COLUMN     "search_norm" TEXT,
ADD COLUMN     "sleeve_grade" VARCHAR(16),
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "user_id" UUID NOT NULL,
ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- DropTable


-- CreateIndex
CREATE INDEX "idx_records_artist_gist_trgm" ON "records"."records" USING GIST ("artist_norm" gist_trgm_ops ASC);

-- CreateIndex
CREATE INDEX "idx_records_artist_trgm" ON "records"."records" USING GIN ("artist" gin_trgm_ops ASC);

-- CreateIndex
CREATE INDEX "idx_records_id_inc_user" ON "records"."records"("id" ASC, "user_id" ASC);

-- CreateIndex
CREATE INDEX "idx_records_name_gist_trgm" ON "records"."records" USING GIST ("name_norm" gist_trgm_ops ASC);

-- CreateIndex
CREATE INDEX "idx_records_name_trgm" ON "records"."records" USING GIN ("name" gin_trgm_ops ASC);

-- CreateIndex
CREATE INDEX "idx_records_search_gin_trgm" ON "records"."records" USING GIN ("search_norm" gin_trgm_ops ASC);

-- CreateIndex
CREATE INDEX "idx_records_user_search_gist_trgm" ON "records"."records" USING GIST ("user_id" gist_uuid_ops ASC, "search_norm" gist_trgm_ops ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "auth"."users"("email" ASC);

-- CreateIndex
CREATE INDEX "records_staging_artist_idx" ON "records"."records_staging" USING GIN ("artist" gin_trgm_ops ASC);

-- CreateIndex
CREATE INDEX "records_staging_artist_name_format_idx" ON "records"."records_staging"("artist" ASC, "name" ASC, "format" ASC);

-- CreateIndex
CREATE INDEX "records_staging_artist_norm_idx" ON "records"."records_staging" USING GIST ("artist_norm" gist_trgm_ops ASC);

-- CreateIndex
CREATE INDEX "records_staging_catalog_number_idx" ON "records"."records_staging"("catalog_number" ASC);

-- CreateIndex
CREATE INDEX "records_staging_id_user_id_idx" ON "records"."records_staging"("id" ASC, "user_id" ASC);

-- CreateIndex
CREATE INDEX "records_staging_name_idx" ON "records"."records_staging" USING GIN ("name" gin_trgm_ops ASC);

-- CreateIndex
CREATE INDEX "records_staging_name_norm_idx" ON "records"."records_staging" USING GIST ("name_norm" gist_trgm_ops ASC);

-- CreateIndex
CREATE INDEX "records_staging_search_norm_idx" ON "records"."records_staging" USING GIST ("search_norm" gist_trgm_ops ASC);

-- CreateIndex
CREATE INDEX "records_staging_user_id_idx" ON "records"."records_staging"("user_id" ASC);

-- AddForeignKey
ALTER TABLE "records"."record_media" ADD CONSTRAINT "record_media_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "records"."records"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "records"."records" ADD CONSTRAINT "records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- RenameIndex

-- RenameIndex

-- RenameIndex

-- RenameIndex

-- RenameIndex

-- RenameIndex

