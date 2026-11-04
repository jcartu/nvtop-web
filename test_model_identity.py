import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app


class ModelIdentityTests(unittest.TestCase):
    def setUp(self):
        app._disk_cache.clear()
        app._engine_cache.clear()
        app.STATE.prev_counters.clear()

    def test_exact_root_outranks_alias_and_generic_alias_stays_ambiguous(self):
        native = "/models/DeepSeek-V4.1-Flash-1017-abliterated-native-overnight"
        csf = "/models/DeepSeek-V4.1-Flash-1017-abliterated-lossless-CSF"
        model = {
            "model_meta": [{"root": os.path.basename(native)}],
            "model_names": ["DeepSeek-V4.1-Flash"],
            "srv_model_path": "/stale/DeepSeek-V4.1-Flash",
        }
        with patch.object(app, "_local_model_dirs", return_value=[native, csf]):
            self.assertEqual(app._match_local_dir("DeepSeek-V4.1-Flash"), "")
            self.assertEqual(app._match_local_dir(os.path.basename(native)), native)
            self.assertEqual(app._resolve_model_path(model, ""), native)

    def test_nested_text_config_supplies_architecture_without_packed_param_guess(self):
        config = {
            "architectures": ["DeepseekV41ForCausalLM"],
            "model_type": "deepseek_v41",
            "dtype": "bfloat16",
            "quantization_config": {"quant_method": "fp8", "expert_dtype": "fp4"},
            "text_config": {
                "vocab_size": 129280,
                "hidden_size": 5120,
                "num_hidden_layers": 40,
                "num_attention_heads": 64,
                "num_key_value_heads": 1,
                "max_position_embeddings": 1048576,
                "q_lora_rank": 1280,
                "n_routed_experts": 384,
                "num_experts_per_tok": 6,
                "n_shared_experts": 1,
            },
        }
        with tempfile.TemporaryDirectory() as td:
            Path(td, "config.json").write_text(json.dumps(config))
            intel = app.disk_intel(td)
        self.assertEqual((intel["layers"], intel["hidden"], intel["heads"], intel["kv_heads"]),
                         (40, 5120, 64, 1))
        self.assertEqual(intel["ctx_native"], 1048576)
        self.assertEqual(intel["attn"], "MLA")
        self.assertEqual(intel["moe"], {"experts": 384, "active": 6, "shared": 1})
        self.assertEqual(intel["quant"], "FP8 + FP4 EXPERTS")
        self.assertFalse(intel.get("params"))

    def test_flare_u8_container_shape_is_not_a_parameter_count(self):
        header = json.dumps({
            "__metadata__": {"format": "flare-payload"},
            "flare.payload": {"dtype": "U8", "shape": [987654321], "data_offsets": [0, 987654321]},
        }).encode()
        with tempfile.TemporaryDirectory() as td:
            Path(td, "model.safetensors").write_bytes(len(header).to_bytes(8, "little") + header)
            self.assertEqual(app._safetensor_params(td), 0)

    def test_deepseek_packaging_and_derivative_variants_remain_distinct(self):
        mixed = {
            "_quant_method": "fp8",
            "_expert_dtype": "fp4",
            "quant": "FP8 + FP4 EXPERTS",
            "dtype": "bfloat16",
        }
        cases = [
            ("DeepSeek-V4.1-Flash-1017-native", mixed, "Stock", "Native mixed FP8/FP4", "FP8 + FP4 EXPERTS"),
            ("DeepSeek-V4.1-Flash-1017-abliterated-native-overnight", mixed,
             "WARMIND abliterated", "Native mixed FP8/FP4", "FP8 + FP4 EXPERTS"),
            ("DeepSeek-V4.1-Flash-1017-lossless-CSF", mixed,
             "Stock", "Lossless FP4-CSF", "LOSSLESS FP4-CSF"),
            ("DeepSeek-V4.1-Flash-1017-abliterated-lossless-CSF", mixed,
             "WARMIND abliterated", "Lossless FP4-CSF", "LOSSLESS FP4-CSF"),
            ("DeepSeek-V4.1-Flash-1017-NVIDIA-NVFP4", {},
             "Stock", "NVIDIA NVFP4", "NVIDIA NVFP4"),
            ("DeepSeek-V4.1-Flash-1017-abliterated-NVIDIA-NVFP4", {},
             "Abliterated", "NVIDIA NVFP4", "NVIDIA NVFP4"),
        ]
        for identity, disk, lineage, packaging, quant in cases:
            with self.subTest(identity=identity):
                details = app._deepseek_v41_details(identity, "DeepSeek-V4.1-Flash", disk)
                self.assertIn(lineage, details["variant"])
                self.assertIn(packaging, details["variant"])
                self.assertEqual(details["quant"], quant)
                self.assertEqual(details["checkpoint"], "1017")
        native = app._deepseek_v41_details(cases[1][0], "DeepSeek-V4.1-Flash", mixed)
        self.assertNotEqual(native["quant"], "NVIDIA NVFP4")

    def test_original_unknown_checkpoint_and_warmind_alias_are_honest(self):
        original = app._deepseek_v41_details("DeepSeek-V4.1-Flash", "served", {})
        unknown = app._deepseek_v41_details("DeepSeek-V4.1-Flash-1024", "served", {})
        alias_only = app._deepseek_v41_details("", "WARMIND", {})
        root_over_alias = app._deepseek_v41_details(
            "DeepSeek-V4.1-Flash-1017-native", "WARMIND-abliterated-NVFP4", {}
        )
        self.assertEqual(original["checkpoint"], "Original")
        self.assertIn("Stock", original["variant"])
        self.assertEqual(unknown["checkpoint"], "1024")
        self.assertNotIn("Stock", unknown["variant"])
        self.assertEqual(app.kb_lookup("WARMIND")["family"], "DeepSeek")
        self.assertEqual(alias_only["variant"], "WARMIND")
        self.assertIn("Stock", root_over_alias["variant"])
        self.assertNotIn("Abliterated", root_over_alias["variant"])
        self.assertNotEqual(root_over_alias["quant"], "NVIDIA NVFP4")

    def test_version_and_source_identity_cannot_be_overridden_by_alias(self):
        self.assertEqual(app._deepseek_v41_details("DeepSeek-V4-Flash", "", {}), {})
        self.assertEqual(app._deepseek_v41_details("GLM-5.3", "DeepSeek-V4.1-Flash", {}), {})
        warmind = app._deepseek_v41_details("WARMIND-1017-NVFP4", "generic", {})
        self.assertEqual(warmind["checkpoint"], "1017")
        self.assertIn("abliterated", warmind["variant"])
        self.assertEqual(warmind["quant"], "NVIDIA NVFP4")

    def test_missing_explicit_checkpoint_does_not_borrow_aliased_weights(self):
        model = {
            "model_meta": [{"root": "DeepSeek-V4.1-Flash-1024-abliterated"}],
            "model_names": ["DeepSeek-V4.1-Flash"],
        }
        with patch.object(app, "_local_model_dirs", return_value=["/models/DeepSeek-V4.1-Flash-1017-native"]):
            self.assertEqual(app._resolve_model_path(model, ""), "")

    def test_enrichment_keeps_runtime_root_package_and_config_provenance_separate(self):
        root = "DeepSeek-V4.1-Flash-1017-abliterated-native-overnight"
        source = f"/models/{root}"
        package = "/mnt/engram-xfs/gb202-tp4-202611021227/model.safetensors"
        model = {
            "model_names": ["DeepSeek-V4.1-Flash"],
            "model_meta": [{"root": root, "max_model_len": 1048576}],
            "worker_pids": [77],
            "gpu_indices": [0, 1, 2, 3],
            "engine": "Flare",
            "engine_version": "",
            "srv_model_path": "",
            "srv_ctx": None,
            "vram_mib": 100.0,
        }
        disk = {
            "_quant_method": "fp8", "_expert_dtype": "fp4",
            "quant": "FP8 + FP4 EXPERTS", "dtype": "bfloat16",
        }
        command = f"/opt/flare run {package} --gpus 0,1,2,3 --served-model-name DeepSeek-V4.1-Flash"
        with patch.object(app, "_ancestor_cmdlines", return_value=command), \
                patch.object(app, "_resolve_model_path", return_value=source), \
                patch.object(app, "disk_intel", return_value=disk), \
                patch.object(app, "_pid_started", return_value=10.0):
            app.enrich_models([model], 20.0)
        intel = model["intel"]
        self.assertEqual(intel["weight_identity"], root)
        self.assertEqual(intel["path"], package)
        self.assertEqual(intel["config_path"], source)
        self.assertEqual(intel["package"], "gb202-tp4-202611021227")
        self.assertEqual(intel["engine"], "Flare")

    def test_flare_scanner_captures_positional_package_and_default_or_explicit_port(self):
        def scan(command):
            def fake_open(path, mode="r", *args, **kwargs):
                if path == "/proc/321/cmdline":
                    return io.BytesIO(command.replace(" ", "\0").encode())
                raise OSError(path)

            with patch.object(app.os, "listdir", return_value=["321"]), \
                    patch("builtins.open", side_effect=fake_open):
                return app._scan_serving_procs()

        base = "/opt/flare run /packages/build-a/model.safetensors --gpus 0,1"
        default = scan(base)
        explicit = scan(base + " --port 8123 --served-model-name Alias")
        self.assertEqual(default, [{
            "pid": 321, "engine": "Flare", "port": 8000, "name": "",
            "mpath": "/packages/build-a/model.safetensors",
        }])
        self.assertEqual(explicit[0]["port"], 8123)
        self.assertEqual(explicit[0]["name"], "Alias")

    def test_flare_metrics_feed_existing_dashboard_fields_without_latency_invention(self):
        cfg = {
            "id": "auto-8000", "endpoint": "http://127.0.0.1:8000", "label": "auto",
            "gpu_indices": [], "accent": "#1", "accent2": "#2",
        }
        counters = {"prompt": 100, "generated": 20, "requests": 4}

        def fake_get(url, timeout=1.5):
            if url.endswith("/v1/models"):
                return 200, json.dumps({"data": [{
                    "id": "DeepSeek-V4.1-Flash", "root": "DeepSeek-V4.1-Flash-1017",
                    "max_model_len": 1048576, "flare": {"max_concurrency": 32},
                }]})
            if url.endswith("/metrics"):
                return 200, "\n".join([
                    f"flare_prefill_tokens_total {counters['prompt']}",
                    f"flare_generated_tokens_total {counters['generated']}",
                    f"flare_requests_completed_total {counters['requests']}",
                    "flare_active_requests 3", "flare_pending_requests 2",
                    "flare_total_kv_pages 100", "flare_free_kv_pages 25",
                ])
            raise AssertionError(f"Flare must not be identified through {url}")

        with patch.object(app, "http_get", side_effect=fake_get):
            first = app.scrape_endpoint(cfg, 10.0)
            counters.update(prompt=150, generated=40, requests=6)
            second = app.scrape_endpoint(cfg, 12.0)
        self.assertEqual(first["engine"], "Flare")
        self.assertEqual(second["engine"], "Flare")
        self.assertEqual((second["input_tps"], second["output_tps"], second["request_rate"]),
                         (25.0, 10.0, 1.0))
        self.assertEqual((second["running"], second["waiting"], second["kv_cache_pct"]),
                         (3, 2, 75.0))
        self.assertIsNone(second["ttft_ms"])
        self.assertIsNone(second["inter_token_ms"])

    def test_model_switch_on_same_endpoint_invalidates_engine_and_counter_cache(self):
        cfg = {
            "id": "auto-9000", "endpoint": "http://127.0.0.1:9000", "label": "auto",
            "gpu_indices": [], "accent": "#1", "accent2": "#2",
        }
        phase = {"engine": "flare"}

        def fake_get(url, timeout=1.5):
            if url.endswith("/v1/models"):
                if phase["engine"] == "flare":
                    return 200, json.dumps({"data": [{"id": "Alias", "root": "Root-A", "flare": {}}]})
                return 200, json.dumps({"data": [{"id": "Alias-B", "root": "Root-B"}]})
            if url.endswith("/metrics"):
                if phase["engine"] == "flare":
                    return 200, "flare_prefill_tokens_total 100\nflare_generated_tokens_total 20"
                return 200, "vllm:prompt_tokens_total 500\nvllm:generation_tokens_total 100"
            if url.endswith("/version"):
                return 200, json.dumps({"version": "test-vllm"})
            raise AssertionError(url)

        with patch.object(app, "http_get", side_effect=fake_get):
            before = app.scrape_endpoint(cfg, 10.0)
            phase["engine"] = "vllm"
            after = app.scrape_endpoint(cfg, 11.0)
        self.assertEqual(before["engine"], "Flare")
        self.assertEqual(after["engine"], "vLLM")
        self.assertEqual(after["model_meta"][0]["root"], "Root-B")
        self.assertEqual(after["label"], "Alias-B · auto")
        self.assertEqual(after["total_tps"], 0.0)

    def test_default_port_flare_endpoint_is_attributed_to_its_gpu_pid(self):
        model = {
            "healthy": True, "port": 8000, "model_names": ["Alias"],
            "engine": "Flare", "label": "Alias · auto", "cfg_gpu_indices": [],
        }
        gpus = [{
            "index": 2,
            "processes": [{"pid": 99, "process_name": "flare", "used_memory_mib": 4096.0}],
        }]
        command = "/opt/flare run /packages/build/model.safetensors --gpus 2"
        with patch.object(app, "_ancestor_cmdlines", return_value=command):
            app.resolve_model_gpus([model], gpus)
        self.assertEqual(model["gpu_indices"], [2])
        self.assertEqual(model["worker_pids"], [99])
        self.assertEqual(model["vram_mib"], 4096.0)

    def test_privacy_mode_scrubs_new_source_identity_fields(self):
        model = {
            "port": 8000, "model_names": ["Alias"], "label": "Alias",
            "srv_model_path": "/secret/source",
            "model_meta": [{"id": "Alias", "root": "Secret-Root"}],
            "intel": {
                "family": "DeepSeek", "display_name": "Secret-Root",
                "weight_identity": "Secret-Root", "package": "secret-package",
                "variant": "Secret variant", "checkpoint": "1017",
                "path": "/secret/package", "config_path": "/secret/source",
            },
        }
        snapshot = {"models": [model], "gpus": []}
        app._mask_snapshot(snapshot)
        intel = model["intel"]
        for key in ("weight_identity", "package", "variant", "checkpoint", "path", "config_path"):
            self.assertEqual(intel[key], "")
        self.assertEqual(intel["display_name"], "DeepSeek")
        self.assertEqual(model["model_meta"][0]["root"], "")


if __name__ == "__main__":
    unittest.main()
