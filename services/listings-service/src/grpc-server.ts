/* cspell:ignore grpc */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as fs from "fs";
import { resolveProtoPath } from "@common/utils/proto";
import {
  getListingById,
  getListingsByUser,
  searchListings,
  createListing,
  updateListing,
  deleteListing,
  placeBid,
  makeOffer,
  addToWatchlist,
  removeFromWatchlist,
  getUserWatchlist,
  pool,
} from "./lib/db";

// Load proto file
const PROTO_PATH = resolveProtoPath("listings.proto");
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const listingsProto = grpc.loadPackageDefinition(packageDefinition) as any;

// gRPC logging middleware
function withLogging(handler: any, methodName: string) {
  return async (call: any, callback: any) => {
    const start = Date.now();
    console.log(`[gRPC] ${methodName} called`);
    try {
      await handler(call, callback);
      const duration = Date.now() - start;
      console.log(`[gRPC] ${methodName} completed in ${duration}ms`);
    } catch (err: any) {
      const duration = Date.now() - start;
      console.error(`[gRPC] ${methodName} failed after ${duration}ms:`, err);
      callback({
        code: grpc.status.INTERNAL,
        message: err.message || "internal error",
      });
    }
  };
}

// Helper to extract user_id from metadata
function getUserId(call: any): string | null {
  const metadata = call.metadata.getMap();
  const auth = metadata.authorization || metadata["authorization"];
  if (!auth || typeof auth !== "string") return null;
  
  try {
    // Extract token from "Bearer <token>"
    const token = auth.replace(/^Bearer\s+/i, "");
    const { verifyJwt } = require("@common/utils/auth");
    const payload = verifyJwt(token);
    return payload.sub || null;
  } catch {
    return null;
  }
}

// Implement ListingsService
const listingsService = {
  async GetListing(call: any, callback: any) {
    try {
      const { listing_id } = call.request;
      if (!listing_id) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: "listing_id required",
        });
      }

      const listing = await getListingById(listing_id);
      if (!listing) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "listing not found",
        });
      }

      callback(null, { listing: formatListing(listing) });
    } catch (error: any) {
      console.error("[gRPC] GetListing error:", error);
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "internal error",
      });
    }
  },

  async ListMyListings(call: any, callback: any) {
    try {
      const userId = getUserId(call);
      if (!userId) {
        return callback({
          code: grpc.status.UNAUTHENTICATED,
          message: "authentication required",
        });
      }

      const limit = call.request.limit || 50;
      const offset = call.request.offset || 0;
      const listings = await getListingsByUser(userId, limit, offset);

      callback(null, {
        listings: listings.map(formatListing),
        count: listings.length,
      });
    } catch (error: any) {
      console.error("[gRPC] ListMyListings error:", error);
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "internal error",
      });
    }
  },

  async SearchListings(call: any, callback: any) {
    try {
      const filters = {
        listing_type: call.request.listing_type || undefined,
        category: call.request.category || undefined,
        min_price: call.request.min_price || undefined,
        max_price: call.request.max_price || undefined,
        condition: call.request.condition || undefined,
        limit: call.request.limit || 50,
        offset: call.request.offset || 0,
      };

      const listings = await searchListings(call.request.query || "", filters);

      callback(null, {
        listings: listings.map(formatListing),
        count: listings.length,
      });
    } catch (error: any) {
      console.error("[gRPC] SearchListings error:", error);
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "internal error",
      });
    }
  },

  async CreateListing(call: any, callback: any) {
    try {
      const userId = getUserId(call);
      if (!userId) {
        return callback({
          code: grpc.status.UNAUTHENTICATED,
          message: "authentication required",
        });
      }

      const listing = await createListing({
        user_id: userId,
        title: call.request.title,
        description: call.request.description,
        price: call.request.price,
        currency: call.request.currency || "USD",
        listing_type: call.request.listing_type || "fixed_price",
        condition: call.request.condition,
        category: call.request.category,
        location: call.request.location,
        shipping_cost: call.request.shipping_cost || 0,
        shipping_method: call.request.shipping_method,
        expires_at: call.request.expires_at ? new Date(call.request.expires_at) : undefined,
      });

      callback(null, { listing: formatListing(listing) });
    } catch (error: any) {
      console.error("[gRPC] CreateListing error:", error);
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "internal error",
      });
    }
  },

  async UpdateListing(call: any, callback: any) {
    try {
      const userId = getUserId(call);
      if (!userId) {
        return callback({
          code: grpc.status.UNAUTHENTICATED,
          message: "authentication required",
        });
      }

      const updates: any = {};
      if (call.request.title !== undefined) updates.title = call.request.title;
      if (call.request.description !== undefined) updates.description = call.request.description;
      if (call.request.price !== undefined) updates.price = call.request.price;
      if (call.request.condition !== undefined) updates.condition = call.request.condition;
      if (call.request.category !== undefined) updates.category = call.request.category;
      if (call.request.location !== undefined) updates.location = call.request.location;
      if (call.request.shipping_cost !== undefined) updates.shipping_cost = call.request.shipping_cost;
      if (call.request.shipping_method !== undefined) updates.shipping_method = call.request.shipping_method;
      if (call.request.is_active !== undefined) updates.is_active = call.request.is_active;

      const listing = await updateListing(call.request.listing_id, userId, updates);
      if (!listing) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "listing not found or unauthorized",
        });
      }

      callback(null, { listing: formatListing(listing) });
    } catch (error: any) {
      console.error("[gRPC] UpdateListing error:", error);
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "internal error",
      });
    }
  },

  async DeleteListing(call: any, callback: any) {
    try {
      const userId = getUserId(call);
      if (!userId) {
        return callback({
          code: grpc.status.UNAUTHENTICATED,
          message: "authentication required",
        });
      }

      const deleted = await deleteListing(call.request.listing_id, userId);
      callback(null, { success: deleted });
    } catch (error: any) {
      console.error("[gRPC] DeleteListing error:", error);
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "internal error",
      });
    }
  },

  async PlaceBid(call: any, callback: any) {
    try {
      const userId = getUserId(call);
      if (!userId) {
        return callback({
          code: grpc.status.UNAUTHENTICATED,
          message: "authentication required",
        });
      }

      const bid = await placeBid(call.request.listing_id, userId, call.request.bid_amount);
      callback(null, { bid: formatBid(bid) });
    } catch (error: any) {
      console.error("[gRPC] PlaceBid error:", error);
      callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: error.message || "internal error",
      });
    }
  },

  async MakeOffer(call: any, callback: any) {
    try {
      const userId = getUserId(call);
      if (!userId) {
        return callback({
          code: grpc.status.UNAUTHENTICATED,
          message: "authentication required",
        });
      }

      const offer = await makeOffer(
        call.request.listing_id,
        userId,
        call.request.offer_amount,
        call.request.message
      );
      callback(null, { offer: formatOffer(offer) });
    } catch (error: any) {
      console.error("[gRPC] MakeOffer error:", error);
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "internal error",
      });
    }
  },

  async AddToWatchlist(call: any, callback: any) {
    try {
      const userId = getUserId(call);
      if (!userId) {
        return callback({
          code: grpc.status.UNAUTHENTICATED,
          message: "authentication required",
        });
      }

      await addToWatchlist(userId, call.request.listing_id);
      callback(null, { success: true });
    } catch (error: any) {
      console.error("[gRPC] AddToWatchlist error:", error);
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "internal error",
      });
    }
  },

  async RemoveFromWatchlist(call: any, callback: any) {
    try {
      const userId = getUserId(call);
      if (!userId) {
        return callback({
          code: grpc.status.UNAUTHENTICATED,
          message: "authentication required",
        });
      }

      const removed = await removeFromWatchlist(userId, call.request.listing_id);
      callback(null, { success: removed });
    } catch (error: any) {
      console.error("[gRPC] RemoveFromWatchlist error:", error);
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "internal error",
      });
    }
  },

  async GetWatchlist(call: any, callback: any) {
    try {
      const userId = getUserId(call);
      if (!userId) {
        return callback({
          code: grpc.status.UNAUTHENTICATED,
          message: "authentication required",
        });
      }

      const watchlist = await getUserWatchlist(userId);
      callback(null, {
        listings: watchlist.map(formatListing),
        count: watchlist.length,
      });
    } catch (error: any) {
      console.error("[gRPC] GetWatchlist error:", error);
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "internal error",
      });
    }
  },

  async HealthCheck(call: any, callback: any) {
    try {
      await pool.query("SELECT 1");
      callback(null, {
        healthy: true,
        version: process.env.SERVICE_VERSION || "1.0.0",
      });
    } catch (error: any) {
      console.error("[gRPC] HealthCheck error:", error);
      callback(null, {
        healthy: false,
        version: process.env.SERVICE_VERSION || "1.0.0",
      });
    }
  },
};

// Format helpers
function formatListing(listing: any): any {
  return {
    id: listing.id,
    user_id: listing.user_id,
    title: listing.title,
    description: listing.description || "",
    price: parseFloat(listing.price) || 0,
    currency: listing.currency || "USD",
    listing_type: listing.listing_type,
    condition: listing.condition || "",
    category: listing.category || "",
    location: listing.location || "",
    shipping_cost: parseFloat(listing.shipping_cost) || 0,
    shipping_method: listing.shipping_method || "",
    is_active: listing.is_active,
    is_featured: listing.is_featured || false,
    view_count: listing.view_count || 0,
    watch_count: listing.watch_count || 0,
    created_at: listing.created_at?.toISOString() || new Date().toISOString(),
    updated_at: listing.updated_at?.toISOString() || new Date().toISOString(),
    expires_at: listing.expires_at?.toISOString() || "",
    images: (listing.images || []).map((img: any) => ({
      id: img.id,
      image_url: img.image_url,
      thumbnail_url: img.thumbnail_url || "",
      display_order: img.display_order || 0,
      is_primary: img.is_primary || false,
    })),
    auction_details: listing.auction_details ? {
      starting_bid: parseFloat(listing.auction_details.starting_bid) || 0,
      current_bid: parseFloat(listing.auction_details.current_bid) || 0,
      current_bidder: listing.auction_details.current_bidder || "",
      reserve_price: parseFloat(listing.auction_details.reserve_price) || 0,
      end_time: listing.auction_details.end_time?.toISOString() || "",
      bid_count: listing.auction_details.bid_count || 0,
    } : undefined,
  };
}

function formatBid(bid: any): any {
  return {
    id: bid.id,
    listing_id: bid.listing_id,
    user_id: bid.user_id,
    bid_amount: parseFloat(bid.bid_amount) || 0,
    is_winning: bid.is_winning || false,
    created_at: bid.created_at?.toISOString() || new Date().toISOString(),
  };
}

function formatOffer(offer: any): any {
  return {
    id: offer.id,
    listing_id: offer.listing_id,
    user_id: offer.user_id,
    offer_amount: parseFloat(offer.offer_amount) || 0,
    message: offer.message || "",
    status: offer.status || "pending",
    created_at: offer.created_at?.toISOString() || new Date().toISOString(),
  };
}

// Create and start gRPC server with HTTP/2 only
export function startGrpcServer(port: number = 50057) {
  const server = new grpc.Server({
    'grpc.keepalive_time_ms': 30000,
    'grpc.keepalive_timeout_ms': 5000,
    'grpc.keepalive_permit_without_calls': 1,
    'grpc.http2.max_pings_without_data': 0,
    'grpc.http2.min_time_between_pings_ms': 10000,
    'grpc.http2.min_ping_interval_without_data_ms': 300000,
  });
  
  server.addService(listingsProto.listings.ListingsService.service, {
    GetListing: withLogging(listingsService.GetListing, "GetListing"),
    ListMyListings: withLogging(listingsService.ListMyListings, "ListMyListings"),
    SearchListings: withLogging(listingsService.SearchListings, "SearchListings"),
    CreateListing: withLogging(listingsService.CreateListing, "CreateListing"),
    UpdateListing: withLogging(listingsService.UpdateListing, "UpdateListing"),
    DeleteListing: withLogging(listingsService.DeleteListing, "DeleteListing"),
    PlaceBid: withLogging(listingsService.PlaceBid, "PlaceBid"),
    MakeOffer: withLogging(listingsService.MakeOffer, "MakeOffer"),
    AddToWatchlist: withLogging(listingsService.AddToWatchlist, "AddToWatchlist"),
    RemoveFromWatchlist: withLogging(listingsService.RemoveFromWatchlist, "RemoveFromWatchlist"),
    GetWatchlist: withLogging(listingsService.GetWatchlist, "GetWatchlist"),
    HealthCheck: withLogging(listingsService.HealthCheck, "HealthCheck"),
  });

  // Try to load TLS certs (for production with ALPN = h2)
  let credentials: grpc.ServerCredentials;
  const keyPath = process.env.TLS_KEY_PATH || "/etc/certs/tls.key";
  const certPath = process.env.TLS_CERT_PATH || "/etc/certs/tls.crt";
  
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);
    credentials = grpc.ServerCredentials.createSsl(
      null,
      [{ private_key: key, cert_chain: cert }],
      false as any
    );
    console.log("[gRPC] Starting secure HTTP/2-only server with ALPN = h2");
  } else {
    console.warn("[gRPC] TLS certs not found, starting insecure server (dev only)");
    credentials = grpc.ServerCredentials.createInsecure();
  }

  server.bindAsync(
    `0.0.0.0:${port}`,
    credentials,
    (error, actualPort) => {
      if (error) {
        console.error("[gRPC] Server bind error:", error);
        return;
      }
      server.start();
      console.log(`[gRPC] Listings server started on port ${actualPort} (HTTP/2 only)`);
    }
  );

  return server;
}

