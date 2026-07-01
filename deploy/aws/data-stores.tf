resource "random_password" "db" {
  length = 28
  # Alphanumeric only: avoids URL-encoding pitfalls when embedded in DATABASE_URL.
  special = false
}

resource "aws_db_subnet_group" "main" {
  name_prefix = "syncore-"
  subnet_ids  = data.aws_subnets.default.ids
}

resource "aws_db_instance" "main" {
  identifier_prefix      = "syncore-"
  engine                 = "postgres"
  engine_version         = var.db_engine_version
  instance_class         = var.db_instance_class
  allocated_storage      = var.db_allocated_storage
  max_allocated_storage  = var.db_max_allocated_storage
  storage_type           = "gp3"
  db_name                = var.db_name
  username               = var.db_username
  password               = random_password.db.result
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]

  publicly_accessible        = false
  multi_az                   = false
  backup_retention_period    = 7
  auto_minor_version_upgrade = true
  deletion_protection        = true
  # deletion_protection blocks accidental destroy; a manual snapshot is the
  # documented pre-teardown step, so we skip the auto final snapshot.
  skip_final_snapshot = true
  apply_immediately   = true
}
