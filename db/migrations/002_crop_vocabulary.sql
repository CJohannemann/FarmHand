-- Crops, so plantings have something to be. Written to be idempotent and run
-- on every app start, which is also how existing local databases pick it up
-- without a migration system.
--
-- `term` has no unique constraint on (vocabulary, name) — farms are free to
-- name things however they like — so this guards with a NOT EXISTS rather
-- than ON CONFLICT.

insert into term (farm_id, vocabulary, name)
select null, 'crop', v.name
  from (values
    ('Tomato'), ('Lettuce'), ('Spinach'), ('Kale'), ('Cabbage'),
    ('Broccoli'), ('Cauliflower'), ('Carrot'), ('Beet'), ('Radish'),
    ('Turnip'), ('Potato'), ('Sweet potato'), ('Onion'), ('Garlic'),
    ('Leek'), ('Bean'), ('Pea'), ('Sweet corn'), ('Squash'),
    ('Pumpkin'), ('Cucumber'), ('Melon'), ('Pepper'), ('Eggplant'),
    ('Asparagus'), ('Rhubarb'), ('Strawberry'), ('Raspberry'),
    ('Blueberry'), ('Apple'), ('Pear'), ('Peach'), ('Plum'),
    ('Grape'), ('Herbs'), ('Hay'), ('Pasture'), ('Cover crop'),
    ('Wheat'), ('Oats'), ('Rye'), ('Sunflower')
  ) as v(name)
 where not exists (
   select 1 from term t
    where t.vocabulary = 'crop' and t.name = v.name and t.farm_id is null
 );
