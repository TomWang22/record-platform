package main

import (
	_ "github.com/record-platform/xk6-http3"
	"go.k6.io/k6/cmd"
)

func main() {
	cmd.Execute()
}
