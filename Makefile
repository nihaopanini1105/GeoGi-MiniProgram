

# BEGIN GEOGI RELEASE TOOL
.PHONY: release
release:
	$(or $(PYTHON_BIN),python3.12) -m tools.live.geogi_release $(ARGS)
# END GEOGI RELEASE TOOL
