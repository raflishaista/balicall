"""Catch missing local imports in the explicit Docker COPY lists."""
import ast
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent


class PackagingTests(unittest.TestCase):
    def test_batch_qwen_image_contains_its_local_imports(self):
        dockerfile = (ROOT / 'Dockerfile.qwen').read_text()
        copied = {word for line in dockerfile.splitlines() if line.startswith('COPY ')
                  for word in line.split()[1:-1]}
        pending = ['qwen_app.py']
        visited = set()
        while pending:
            name = pending.pop()
            if name in visited:
                continue
            visited.add(name)
            self.assertIn(name, copied, f'Docker image would fail importing {name}')
            tree = ast.parse((ROOT / name).read_text())
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and node.module:
                    target = node.module.split('.')[0] + '.py'
                    if (ROOT / target).is_file():
                        pending.append(target)


if __name__ == '__main__':
    unittest.main()
