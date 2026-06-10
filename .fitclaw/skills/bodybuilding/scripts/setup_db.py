#!/usr/bin/env python3
"""
bodybuilding Skill 数据库验证脚本

功能：
- 检查数据库是否存在
- 验证数据库完整性
- 显示数据库信息

数据库已内嵌在 skill 仓库中，无需额外下载。
"""

import os
import sys
import json
import argparse
from pathlib import Path

DB_NAME = "free-exercise-db"


def get_skill_dir():
    """获取技能目录路径"""
    return Path(__file__).parent.parent.resolve()


def get_db_path():
    """获取数据库路径"""
    return get_skill_dir() / DB_NAME


def check_db_exists():
    """检查数据库是否存在"""
    db_path = get_db_path()
    exercises_path = db_path / "exercises"
    dist_path = db_path / "dist" / "exercises.json"

    return exercises_path.exists() or dist_path.exists()


def setup_database():
    """验证数据库是否可用"""
    if check_db_exists():
        print(f"数据库已就绪: {get_db_path()}")
        return True
    else:
        print("数据库不存在，请检查 skill 仓库是否完整")
        return False


def verify_database():
    """验证数据库完整性"""
    db_path = get_db_path()
    exercises_path = db_path / "exercises"
    dist_path = db_path / "dist" / "exercises.json"

    print(f"验证数据库: {db_path}")

    if not db_path.exists():
        print("数据库目录不存在")
        return False

    # 优先检查合并文件
    if dist_path.exists():
        try:
            with open(dist_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, list):
                print(f"合并文件有效，包含 {len(data)} 个动作")
                return True
            else:
                print("合并文件格式错误")
                return False
        except (json.JSONDecodeError, IOError) as e:
            print(f"读取合并文件失败: {e}")
            return False

    # 回退到检查 exercises 目录
    if exercises_path.exists():
        exercise_dirs = [d for d in exercises_path.iterdir() if d.is_dir()]
        print(f"找到 {len(exercise_dirs)} 个动作目录")

        sample_dirs = exercise_dirs[:3]
        for d in sample_dirs:
            exercise_json = d / "exercise.json"
            if exercise_json.exists():
                try:
                    with open(exercise_json, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    print(f"  {data.get('name', d.name)}")
                except (json.JSONDecodeError, IOError) as e:
                    print(f"  {d.name}: {e}")
                    return False
        return True

    print("数据库不完整：缺少 exercises 目录和 dist/exercises.json")
    return False


def get_db_info():
    """获取数据库信息"""
    db_path = get_db_path()

    if not db_path.exists():
        print("数据库不存在")
        return

    print(f"数据库路径: {db_path}")

    # 统计动作目录数量
    exercises_path = db_path / "exercises"
    if exercises_path.exists():
        dirs = [d for d in exercises_path.iterdir() if d.is_dir()]
        count = len(dirs)
        print(f"动作目录数: {count}")

    # 检查合并文件
    dist_path = db_path / "dist" / "exercises.json"
    if dist_path.exists():
        size_kb = dist_path.stat().st_size / 1024
        print(f"合并文件: dist/exercises.json ({size_kb:.0f} KB)")

    print("数据来源: skill 仓库内嵌")


def main():
    parser = argparse.ArgumentParser(
        description="bodybuilding Skill 数据库验证工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python setup_db.py              # 检查数据库是否就绪
  python setup_db.py --verify     # 验证数据库完整性
  python setup_db.py --info       # 显示数据库信息
  python setup_db.py --check      # 检查数据库是否存在
        """
    )

    parser.add_argument("--verify", action="store_true", help="验证数据库完整性")
    parser.add_argument("--info", action="store_true", help="显示数据库信息")
    parser.add_argument("--check", action="store_true", help="检查数据库是否存在")

    args = parser.parse_args()

    if args.check:
        exists = check_db_exists()
        print(f"数据库存在: {exists}")
        if exists:
            print(f"路径: {get_db_path()}")
        sys.exit(0 if exists else 1)

    if args.info:
        get_db_info()
        sys.exit(0)

    if args.verify:
        success = verify_database()
        sys.exit(0 if success else 1)

    # 默认：检查就绪状态
    success = setup_database()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
