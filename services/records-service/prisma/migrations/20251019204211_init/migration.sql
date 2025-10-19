-- CreateTable
CREATE TABLE "records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "artist" VARCHAR(256) NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "format" VARCHAR(64) NOT NULL,
    "record_grade" VARCHAR(16),
    "sleeve_grade" VARCHAR(16),
    "has_insert" BOOLEAN NOT NULL DEFAULT false,
    "insert_grade" VARCHAR(16),
    "has_booklet" BOOLEAN NOT NULL DEFAULT false,
    "booklet_grade" VARCHAR(16),
    "has_obi_strip" BOOLEAN NOT NULL DEFAULT false,
    "obi_strip_grade" VARCHAR(16),
    "has_factory_sleeve" BOOLEAN NOT NULL DEFAULT false,
    "factory_sleeve_grade" VARCHAR(16),
    "is_promo" BOOLEAN NOT NULL DEFAULT false,
    "catalog_number" VARCHAR(64),
    "notes" TEXT,
    "purchased_at" TIMESTAMP(3),
    "price_paid" DECIMAL(10,2),
    "release_year" INTEGER,
    "release_date" TIMESTAMP(3),
    "pressing_year" INTEGER,
    "label" VARCHAR(128),
    "label_code" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_media" (
    "id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "size_inch" INTEGER,
    "speed_rpm" INTEGER,
    "disc_grade" VARCHAR(16),
    "sides" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "record_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "records_user_id_idx" ON "records"("user_id");

-- CreateIndex
CREATE INDEX "records_artist_idx" ON "records"("artist");

-- CreateIndex
CREATE INDEX "records_catalog_number_idx" ON "records"("catalog_number");

-- CreateIndex
CREATE INDEX "records_artist_name_format_idx" ON "records"("artist", "name", "format");

-- CreateIndex
CREATE INDEX "records_release_year_idx" ON "records"("release_year");

-- CreateIndex
CREATE INDEX "records_label_idx" ON "records"("label");

-- CreateIndex
CREATE UNIQUE INDEX "record_media_record_id_index_key" ON "record_media"("record_id", "index");

-- AddForeignKey
ALTER TABLE "record_media" ADD CONSTRAINT "record_media_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
