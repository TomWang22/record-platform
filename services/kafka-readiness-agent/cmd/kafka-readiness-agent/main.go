package main

import (
	"context"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"record-platform/kafka-readiness-agent/internal/agent"
	"record-platform/kafka-readiness-agent/internal/check"
	"record-platform/kafka-readiness-agent/internal/config"
	"record-platform/kafka-readiness-agent/internal/httpapi"
	"record-platform/kafka-readiness-agent/internal/metrics"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	cfg, err := config.LoadFromEnv()
	if err != nil {
		slog.Error("config", "err", err)
		os.Exit(1)
	}
	if err := assertLoopback(cfg.HTTPAddr); err != nil {
		slog.Error("http_addr", "err", err)
		os.Exit(1)
	}

	checker, err := check.NewKafkaChecker(cfg)
	if err != nil {
		slog.Error("tls_config", "err", err)
		os.Exit(1)
	}

	m := metrics.New()
	ag := agent.New(cfg, checker, m)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go ag.Run(ctx)

	srv := httpapi.New(cfg.HTTPAddr, ag)
	go func() {
		slog.Info("http_listen", "addr", cfg.HTTPAddr, "broker", cfg.BrokerAddr)
		if err := srv.ListenAndServe(); err != nil {
			slog.Error("http_serve", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	slog.Info("shutdown")
	checker.Reset()
}

func assertLoopback(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if ip == nil {
		if host == "localhost" {
			return nil
		}
		return errNonLoopback(host)
	}
	if !ip.IsLoopback() {
		return errNonLoopback(host)
	}
	return nil
}

type nonLoopbackError string

func (e nonLoopbackError) Error() string {
	return "HTTP_ADDR must be loopback only, got " + string(e)
}

func errNonLoopback(host string) error {
	return nonLoopbackError(strings.TrimSpace(host))
}
