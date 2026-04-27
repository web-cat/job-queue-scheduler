import unittest
import importlib.util
import os


def load_submission():
    path = "/tmp/grader-python/submission.py"
    if not os.path.exists(path):
        raise FileNotFoundError("expected submission.py at submission root")
    spec = importlib.util.spec_from_file_location("submission", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


class SubmissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sub = load_submission()

    def test_add(self):
        self.assertEqual(self.sub.add(2, 3), 5)

    def test_sub(self):
        self.assertEqual(self.sub.sub(7, 4), 3)

    def test_add_negative(self):
        self.assertEqual(self.sub.add(-1, 5), 4)

    def test_sub_zero(self):
        self.assertEqual(self.sub.sub(0, 0), 0)

