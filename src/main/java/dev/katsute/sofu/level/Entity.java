/*
 * Copyright (C) 2026 Katsute <https://github.com/Katsute>
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program; if not, write to the Free Software Foundation, Inc.,
 * 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
 */

package dev.katsute.sofu.level;

import java.util.HashMap;
import java.util.Map;

public class Entity {

    final String entity;
    final protected Map<String,String> props = new HashMap<>();

    public Entity(String entity){
        this.entity = entity;
    }

    public final String toXML(){
        return '<' + entity + '>'
            + props.entrySet().stream()
                .map(e -> ' ' + e.getKey() + "=\"" + e.getValue() + '"')
                .reduce("", (a, b) -> a + b)
                .trim()
            + "</" + entity + '>';
    }

}