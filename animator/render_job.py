# One render, one process. AnimatedDrawings uses glfw, which macOS only allows
# on a process's MAIN thread — so the server shells out to this script instead
# of rendering inside a FastAPI worker thread (which hard-crashes the process).
# Usage: python render_job.py <char_dir> <motion_cfg.yaml> <retarget_cfg.yaml> <out.gif>
import faulthandler
import os
import sys

import yaml

if os.environ.get("ANIMATOR_TRACE"):
    # print a full python stack every 20s — for diagnosing renders that hang
    faulthandler.dump_traceback_later(20, repeat=True)


def main() -> None:
    char_dir, motion_cfg_fn, retarget_cfg_fn, out_gif = sys.argv[1:5]
    mvc = {
        "scene": {
            "ANIMATED_CHARACTERS": [{
                "character_cfg": os.path.join(char_dir, "char_cfg.yaml"),
                "motion_cfg": motion_cfg_fn,
                "retarget_cfg": retarget_cfg_fn,
            }]
        },
        "controller": {"MODE": "video_render", "OUTPUT_VIDEO_PATH": out_gif},
    }
    mvc_fn = os.path.join(char_dir, "mvc_cfg.yaml")
    with open(mvc_fn, "w") as f:
        yaml.dump(mvc, f)

    import animated_drawings.render

    animated_drawings.render.start(mvc_fn)


if __name__ == "__main__":
    main()
